import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { noDynamicImportPath } from "./no-dynamic-import-path.js";

interface NodeConfigurationLoaderCase {
  name: string;
  code: string;
  fixturePackage: object;
  expectedCount: number;
}

const cases: NodeConfigurationLoaderCase[] = [
  {
    name: "canonical-node-file-url-loading",
    code: 'import { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "paired-sync-and-file-url-config-loaders",
    code: 'import discover from "find-config";\nimport { pathToFileURL } from "url";\nexport const loadSync = (directory) => { const file = discover("widget.config.js", {cwd:directory}); if (file) return require(file); };\nexport const loadAsync = async (directory) => { const file = discover("widget.config.mjs", {cwd:directory}); if (file) return import(pathToFileURL(file).href); };\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "canonical-named-import-alias",
    code: 'import { pathToFileURL as toFileUrl } from "url";\nexport const load = (file) => import(toFileUrl(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "bare-url-parse-browser-adjacent",
    code: 'import { parse } from "url";\nexport const load = (file) => { parse(file); return import(file); };\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "unused-canonical-import",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(file);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-import-declaration",
    code: 'import type { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-import-specifier",
    code: 'import { type pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "foreign-same-export",
    code: 'import { pathToFileURL } from "url-adapter";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-callback-parameter",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file, pathToFileURL) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-alias-transport-deferred",
    code: 'import { pathToFileURL } from "url";\nconst convert = pathToFileURL;\nexport const load = (file) => import(convert(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "whole-provider-value-escape",
    code: 'import { pathToFileURL } from "url";\nconsume(pathToFileURL);\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "secondary-namespace-provider-write",
    code: 'import { pathToFileURL } from "url";\nimport * as urlApi from "url";\nurlApi.pathToFileURL = (file) => ({href:file});\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-href-deferred",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file)["href"]);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "optional-converter-call-deferred",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL?.(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "react-client-module-deferred",
    code: 'import React from "react";\nimport { pathToFileURL } from "url";\nexport const View = () => <div />;\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "namespace-only-carrier-deferred",
    code: 'import * as urlApi from "url";\nexport const load = (file) => import(urlApi.pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "default-only-carrier-deferred",
    code: 'import urlApi from "url";\nexport const load = (file) => import(urlApi.pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "node-prefix-old-classifier",
    code: 'import { pathToFileURL } from "node:url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "filesystem-import-old-classifier",
    code: 'import fs from "fs";\nexport const load = (file) => { fs.existsSync(file); return require(file); };\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "plain-unknown-browser-dynamic-import",
    code: "export const load = (file) => import(file);\n",
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "missing-node-engine-profile",
    code: 'import { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-unknown-package",
      main: "index.js",
    },
    expectedCount: 1,
  },
  {
    name: "browser-mapped-package-deferred",
    code: 'import { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
      browser: {
        "./index.js": "./browser.js",
      },
    },
    expectedCount: 1,
  },
  {
    name: "conditional-exports-package-deferred",
    code: 'import { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
      exports: {
        ".": {
          browser: "./browser.js",
          default: "./index.js",
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "runtime-enum-profile-deferred",
    code: 'enum Mode { Ready = 1 }\nimport { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "unresolved-eval-reference-deferred",
    code: 'void eval;\nimport { pathToFileURL } from "url";\nexport const load = (filename: string) => import(pathToFileURL(filename).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "static-literal-old-quiet",
    code: 'export const load = () => import("./adapter.js");\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "const-string-indirection-old-quiet",
    code: 'export const load = () => { const file = "./adapter.js"; return import(file); };\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "whatwg-url-is-browser-compatible",
    code: 'export const load = (file) => import(new URL(file, "https://example.invalid").href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "destructuring-provider-write",
    code: 'import { pathToFileURL } from "url";\n({ convert: pathToFileURL } = replacement);\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "for-of-provider-write",
    code: 'import { pathToFileURL } from "url";\nfor (pathToFileURL of replacements) {}\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "duplicate-named-provider",
    code: 'import { pathToFileURL } from "url";\nimport { pathToFileURL as second } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "unused-default-provider",
    code: 'import { pathToFileURL } from "url";\nimport urlApi from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "named-default-provider",
    code: 'import { pathToFileURL } from "url";\nimport { default as urlApi } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-namespace-runtime-write",
    code: 'import { pathToFileURL } from "url";\nimport type * as urlApi from "url";\nurlApi.pathToFileURL = replacement;\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "spread-call-argument",
    code: 'import { pathToFileURL } from "url";\nexport const load = (files) => import(pathToFileURL(...files).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "extra-call-argument",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file, settings) => import(pathToFileURL(file, settings).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "href-value-escape",
    code: 'import { pathToFileURL } from "url";\nconst href = pathToFileURL(file).href;\nexport const load = () => import(href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "erased-interface-and-annotation",
    code: 'import { pathToFileURL } from "url";\ninterface LoaderInput { file: string }\nexport const load = ({ file }: LoaderInput) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "asserted-provider-callee",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import((pathToFileURL as any)(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "ordinary-eval-property-profile",
    code: 'import { pathToFileURL } from "url";\nconst tooling = { eval: observer };\nconsume(tooling.eval);\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "erased-provider-type-query",
    code: 'import { pathToFileURL } from "url";\ntype LoaderFactory = typeof pathToFileURL;\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "empty-node-engine",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: " ",
      },
    },
    expectedCount: 1,
  },
  {
    name: "empty-main-entry",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "browser-false-field",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
      browser: false,
    },
    expectedCount: 1,
  },
  {
    name: "null-exports-field",
    code: 'import { pathToFileURL } from "url";\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
      exports: null,
    },
    expectedCount: 1,
  },
  {
    name: "two-closed-file-url-imports",
    code: 'import { pathToFileURL } from "url";\nexport const loadFirst = (file) => import(pathToFileURL(file).href);\nexport const loadSecond = (other) => import(pathToFileURL(other).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
  {
    name: "exported-provider-value",
    code: 'import { pathToFileURL } from "url";\nexport { pathToFileURL };\nexport const load = (file) => import(pathToFileURL(file).href);\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 1,
  },
  {
    name: "unrelated-runtime-expression-assertion",
    code: 'import { pathToFileURL } from "url";\nexport const load = async (file: string) => { try { return await import(pathToFileURL(file).href); } catch (error) { throw new Error((error as Error).message); } };\n',
    fixturePackage: {
      name: "synthetic-node-tooling",
      version: "1.0.0",
      main: "index.js",
      engines: {
        node: ">=20",
      },
    },
    expectedCount: 0,
  },
];

describe("Node file URL configuration loader", () => {
  it.each(cases)("$name", (fixture) => {
    const directory = mkdtempSync(join(tmpdir(), "rd-node-file-url-"));
    const filename = join(directory, "loader.tsx");
    writeFileSync(join(directory, "package.json"), JSON.stringify(fixture.fixturePackage));
    writeFileSync(filename, fixture.code);
    resetManifestCaches();
    try {
      const result = runRule(noDynamicImportPath, fixture.code, {
        filename,
        forceJsx: false,
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expectedCount);
    } finally {
      resetManifestCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
