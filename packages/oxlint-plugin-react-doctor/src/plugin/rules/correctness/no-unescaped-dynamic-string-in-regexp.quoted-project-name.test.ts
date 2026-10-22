import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

interface QuotedProjectFixture {
  readonly name: string;
  readonly expected: number;
  readonly descriptors?: string;
  readonly bridge?: string;
  readonly caller?: string;
  readonly companions?: Readonly<Record<string, string>>;
}

const descriptors = `export const buildChanges = ({ before, after }) => [
  { files: 'workspace.xml', from: [/old/, new RegExp(before, 'g')], to: after },
  { files: '.name', from: before, to: after },
];`;

const bridge = `import fs from 'node:fs';
import path from 'node:path';
import replace from 'replace-in-file';
import { buildChanges } from './descriptors.js';
export const readExisting = () => {
  const filename = path.join('/workspace', 'android', 'settings.gradle');
  const contents = fs.readFileSync(filename, 'utf8');
  const extracted = contents.match(/rootProject.name\\s+=\\s+['"](.*)['"]/)[1];
  if (extracted) { return extracted; }
  throw new Error('Missing project name');
};
const applyChanges = async options => {
  const jobs = options.map(async option => {
    const prepared = { ...option, countMatches: true, allowEmptyPaths: true, files: option.files };
    await replace(prepared);
  });
  await Promise.all(jobs);
};
export const updateExisting = async ({ previous, next }) => {
  const options = buildChanges({ before: previous, after: next });
  await applyChanges(options);
};`;

const caller = `import { readExisting, updateExisting } from './bridge.js';
export const executeRename = async replacement => {
  const existing = readExisting();
  await updateExisting({ previous: existing, next: replacement });
};`;

const cases: ReadonlyArray<QuotedProjectFixture> = [
  {
    name: "follows a quoted project-name text producer through two object properties",
    expected: 1,
  },
  {
    name: "preserves shorthand object-property forwarding",
    expected: 1,
    bridge: bridge.replaceAll("previous", "before").replace("before: before", "before"),
    caller: caller.replaceAll("existing", "before").replace("previous: before", "before"),
  },
  {
    name: "declines a filesystem reader replaced through a legacy accessor",
    expected: 0,
    bridge:
      bridge +
      "\nfs.__defineGetter__('readFileSync', () => 'rootProject.name = \"^authored.*$\"');",
  },
  {
    name: "declines a path provider replaced through a legacy accessor",
    expected: 0,
    bridge: bridge + "\npath.__defineGetter__('join', () => forged);",
  },
  {
    name: "supports direct local producer and forwarding calls",
    expected: 1,
    bridge:
      bridge + caller.replace("import { readExisting, updateExisting } from './bridge.js';", ""),
    caller: "",
  },
  {
    name: "declines a local generator producer returning an iterator",
    expected: 0,
    bridge:
      bridge.replace("export const readExisting = () => {", "const readExisting = function* () {") +
      caller.replace("import { readExisting, updateExisting } from './bridge.js';", ""),
    caller: "",
  },
  {
    name: "does not require all callers to have the same text role",
    expected: 1,
    caller: caller + "\nupdateExisting({previous:'^authored.*$',next:'other'});",
  },
  {
    name: "preserves renamed import bindings and property aliases",
    expected: 1,
    caller: caller
      .replace("readExisting, updateExisting", "readExisting as obtain, updateExisting as write")
      .replace("existing = readExisting()", "existing = obtain()")
      .replace("await updateExisting(", "await write("),
  },
  {
    name: "supports an ordinary environment-selected project directory",
    expected: 1,
    bridge: bridge
      .replace(
        "export const readExisting",
        "const directory = process.env.ROOT_DIRECTORY || process.cwd();\nexport const readExisting",
      )
      .replace("path.join('/workspace',", "path.join(directory,"),
  },
  {
    name: "supports a producer that explicitly escapes the property selector dot",
    expected: 1,
    bridge: bridge.replace("rootProject.name", "rootProject\\.name"),
  },
  {
    name: "does not infer a literal role from replacement syntax alone",
    expected: 0,
    caller:
      "import {updateExisting} from './bridge.js'; updateExisting({previous:readPattern(),next:'other'});",
  },
  {
    name: "does not infer literal intent from a project-like parameter name",
    expected: 0,
    caller:
      "import {updateExisting} from './bridge.js'; export const run=currentName=>updateExisting({previous:currentName,next:'other'});",
  },
  {
    name: "declines a different quoted configuration field",
    expected: 0,
    bridge: bridge.replace("rootProject.name", "authoredPattern"),
  },
  {
    name: "declines a different configuration file",
    expected: 0,
    bridge: bridge.replace("settings.gradle", "patterns.gradle"),
  },
  {
    name: "declines binary or unspecified file decoding",
    expected: 0,
    bridge: bridge.replace("'utf8'", "'hex'"),
  },
  {
    name: "declines a different capture slot",
    expected: 0,
    bridge: bridge.replace(")[1]", ")[0]"),
  },
  {
    name: "declines a capture that can instead return an authored pattern",
    expected: 0,
    bridge: bridge.replace("return extracted;", "return '.*';"),
  },
  {
    name: "declines an escaped or transformed forwarded value",
    expected: 0,
    caller: caller.replace("previous: existing", "previous: escapeRegExp(existing)"),
  },
  {
    name: "preserves an escaped constructor argument",
    expected: 0,
    descriptors: descriptors.replace("new RegExp(before,", "new RegExp(RegExp.escape(before),"),
  },
  {
    name: "preserves a native RegExp shadow",
    expected: 0,
    descriptors: "const RegExp = customCompiler;\n" + descriptors,
  },
  {
    name: "declines a reassigned capture alias",
    expected: 0,
    caller: caller
      .replace("const existing", "let existing")
      .replace("await updateExisting", "existing = readPattern(); await updateExisting"),
  },
  {
    name: "declines an options spread at the forwarding boundary",
    expected: 0,
    caller: caller.replace("{ previous: existing,", "{ ...extra, previous: existing,"),
  },
  {
    name: "declines duplicate forwarding fields",
    expected: 0,
    caller: caller.replace("previous: existing,", "previous: existing, previous: readPattern(),"),
  },
  {
    name: "declines a mutable wrapper parameter",
    expected: 0,
    bridge: bridge.replace(
      "const options = buildChanges",
      "previous = readPattern(); const options = buildChanges",
    ),
  },
  {
    name: "declines a captured text alias that escapes",
    expected: 0,
    caller: caller.replace("await updateExisting", "inspect(existing); await updateExisting"),
  },
  {
    name: "declines a returned regex with no replacement descriptor",
    expected: 0,
    descriptors: "export const buildChanges=({before,after})=>new RegExp(before,'g');",
  },
  {
    name: "declines a replacement from override after spreading options",
    expected: 0,
    bridge: bridge.replace(
      "...option, countMatches",
      "...option, from: readPattern(), countMatches",
    ),
  },
  {
    name: "declines an options escape before applying replacements",
    expected: 0,
    bridge: bridge.replace(
      "await applyChanges(options)",
      "inspect(options); await applyChanges(options)",
    ),
  },
  {
    name: "declines a prepared options escape",
    expected: 0,
    bridge: bridge.replace("await replace(prepared)", "inspect(prepared); await replace(prepared)"),
  },
  {
    name: "declines a replacement import remap",
    expected: 0,
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"replace-in-file":["./replacement.js"]}}}',
      "replacement.js": "export default options=>options;",
    },
  },
  {
    name: "declines native providers obtained through the process loader",
    expected: 0,
    caller: "const files=process.getBuiltinModule('fs'); files.readFileSync=forged;\n" + caller,
  },
  {
    name: "declines a process module capability alias",
    expected: 0,
    caller:
      "import runtime from 'node:process'; const files=runtime.getBuiltinModule('fs'); files.readFileSync=forged;\n" +
      caller,
  },
  {
    name: "declines a filesystem provider changed in the caller module",
    expected: 0,
    caller: "import files from 'node:fs'; files.readFileSync=forged;\n" + caller,
  },
  {
    name: "declines a filesystem provider changed in a companion module",
    expected: 0,
    companions: { "patch.js": "import files from 'node:fs'; files.readFileSync=forged;" },
  },
  {
    name: "declines an async descriptor builder returning a promise",
    expected: 0,
    descriptors: descriptors.replace("= ({ before, after })", "= async ({ before, after })"),
  },
  {
    name: "declines an unexecuted generator replacement mapper",
    expected: 0,
    bridge: bridge
      .replace("options.map(async option =>", "options.map(function* (option)")
      .replace("await replace(prepared)", "replace(prepared)"),
  },
  {
    name: "declines replacement inside an uncalled nested closure",
    expected: 0,
    bridge: bridge.replace("await replace(prepared)", "const deferred = () => replace(prepared)"),
  },
  {
    name: "declines a filesystem import remap",
    expected: 0,
    companions: {
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"node:fs":["./files.js"]}}}',
      "files.js": "export default {readFileSync:()=>'.*'};",
    },
  },
  {
    name: "declines an alternate filesystem namespace exposure",
    expected: 0,
    bridge: "import * as alternate from 'node:fs'; alternate.readFileSync = () => '.*';\n" + bridge,
  },
  {
    name: "declines an extracted native match implementation",
    expected: 0,
    bridge: bridge + "\nconst builtin = String; builtin.prototype.match = compilePattern;",
  },
  {
    name: "declines visible native regexp replacement",
    expected: 0,
    bridge: bridge + "\nRegExp.prototype.exec = customExec;",
  },
  {
    name: "declines a computed constructor transport",
    expected: 0,
    bridge: bridge + "\nconst compile = (()=>{})['con'+'structor'];",
  },
  {
    name: "declines a computed destructuring capability transport",
    expected: 0,
    bridge:
      bridge +
      "\nconst selector='constructor'; const {[selector]: compile}=()=>{}; const root=compile('return process')(); root.getBuiltinModule('fs').readFileSync=forged;",
  },
  {
    name: "declines an erased capability spelling",
    expected: 0,
    bridge: "interface eval {}\n" + bridge + "\neval('String.prototype.match = forged');",
  },
  {
    name: "declines a dynamic module loader",
    expected: 0,
    bridge: bridge + "\nimport('runtime-patch');",
  },
  {
    name: "declines a runtime TypeScript native mutation",
    expected: 0,
    bridge: bridge + "\nenum Patch { Applied = (String.prototype.match = forged, 0) }",
  },
  {
    name: "declines an object-valued directory coercion",
    expected: 0,
    bridge: bridge.replace(
      "path.join('/workspace',",
      "path.join({toString(){return '/workspace'}},",
    ),
  },
  {
    name: "declines a barrel rather than claiming unsupported value identity",
    expected: 0,
    caller: caller.replace("'./bridge.js'", "'./public.js'"),
    companions: { "public.js": "export {readExisting,updateExisting} from './bridge.js';" },
  },
  {
    name: "declines a missing producer module",
    expected: 0,
    caller: caller.replace("'./bridge.js'", "'./absent.js'"),
  },
];

let directory = "";
const writeFile = (relativePath: string, source: string): string => {
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};
const inspectDescriptors = (source = descriptors) => {
  const result = runRule(noUnescapedDynamicStringInRegexp, source, {
    filename: path.join(directory, "descriptors.js"),
    settings: { "react-doctor": { rootDirectory: directory } },
  });
  expect(result.parseErrors).toEqual([]);
  return result;
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-project-origin-"));
  writeFile("package.json", '{"type":"module"}');
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("quoted project-name literal RegExp provenance", () => {
  it.each(cases)("$name", (fixture) => {
    const source = fixture.descriptors ?? descriptors;
    writeFile("descriptors.js", source);
    writeFile("bridge.ts", fixture.bridge ?? bridge);
    writeFile("entry.js", fixture.caller ?? caller);
    for (const [filename, companion] of Object.entries(fixture.companions ?? {}))
      writeFile(filename, companion);
    resetFilesystemCaches();
    const result = inspectDescriptors(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(fixture.expected);
  });

  it("rebuilds positive caller membership after appearance and deletion", () => {
    writeFile("descriptors.js", descriptors);
    writeFile("bridge.ts", bridge);
    const counts: number[] = [];
    counts.push(inspectDescriptors().diagnostics.length);
    const filename = writeFile("entry.js", caller);
    resetFilesystemCaches();
    counts.push(inspectDescriptors().diagnostics.length);
    fs.unlinkSync(filename);
    resetFilesystemCaches();
    counts.push(inspectDescriptors().diagnostics.length);
    expect(counts).toEqual([0, 1, 0]);
  });

  it("refreshes same-sized provider edits after restored mtime at a scan boundary", () => {
    writeFile("descriptors.js", descriptors);
    const filename = writeFile("bridge.ts", bridge);
    writeFile("entry.js", caller);
    const metadata = fs.statSync(filename);
    const counts = [inspectDescriptors().diagnostics.length];
    const changed = bridge.replace("settings.gradle", "patterns.gradle");
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(bridge));
    fs.writeFileSync(filename, changed);
    fs.utimesSync(filename, metadata.atime, metadata.mtime);
    resetFilesystemCaches();
    counts.push(inspectDescriptors().diagnostics.length);
    fs.writeFileSync(filename, bridge);
    fs.utimesSync(filename, metadata.atime, metadata.mtime);
    resetFilesystemCaches();
    counts.push(inspectDescriptors().diagnostics.length);
    expect(counts).toEqual([1, 0, 1]);
  });
});
