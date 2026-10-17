import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import { findRuntimeValueSymbol } from "./find-runtime-value-symbol.js";

const cases = [
  {
    code: "const candidate = 0; candidate;",
    expectedKind: "const",
  },
  {
    code: "const candidate = 0; interface candidate {} candidate;",
    expectedKind: "const",
  },
  {
    code: "interface candidate {} const candidate = 0; candidate;",
    expectedKind: "const",
  },
  {
    code: "const candidate = 0; type candidate = unknown; candidate;",
    expectedKind: "const",
  },
  {
    code: "interface candidate {} candidate;",
    expectedKind: null,
  },
  {
    code: "declare const candidate: unknown; candidate;",
    expectedKind: null,
  },
  {
    code: 'import type candidate = require("provider-types"); candidate;',
    expectedKind: null,
  },
  {
    code: 'import candidate = require("provider-values"); candidate;',
    expectedKind: "ts-import-equals",
  },
  {
    code: "namespace candidate {} candidate;",
    expectedKind: null,
  },
  {
    code: "namespace candidate { export const marker = 1; } candidate;",
    expectedKind: "ts-module",
  },
  {
    code: "const candidate = 0; namespace candidate { export interface Marker {} } candidate;",
    expectedKind: "const",
  },
  {
    code: "const candidate = 0; const owner = () => { interface candidate {} return candidate; };",
    expectedKind: "const",
  },
  {
    code: "interface candidate {} const owner = () => { const candidate = 0; }; candidate;",
    expectedKind: null,
  },
  {
    code: "const owner = (candidate: unknown) => { interface candidate {} return candidate; };",
    expectedKind: "parameter",
  },
];

describe("findRuntimeValueSymbol", () => {
  it.each(cases)("resolves $code", ({ code, expectedKind }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let identifier: EsTreeNode | null = null;
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "candidate" &&
        scopes.referenceFor(node)
      )
        identifier = node;
    });
    expect(identifier).not.toBeNull();
    if (!identifier) throw new Error("Missing fixture reference");
    const symbol = findRuntimeValueSymbol(identifier, scopes);
    expect(symbol?.kind ?? null).toBe(expectedKind);
    expect(findRuntimeValueSymbol(identifier, scopes)).toBe(symbol);
  });
});
