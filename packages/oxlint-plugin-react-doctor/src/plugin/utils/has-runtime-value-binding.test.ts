import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";

describe("hasRuntimeValueBinding", () => {
  it.each([
    { code: "interface candidate {}", expected: false, nested: false },
    { code: "type candidate = unknown;", expected: false, nested: false },
    { code: "declare const candidate: unknown;", expected: false, nested: false },
    { code: "declare class candidate {}", expected: false, nested: false },
    { code: 'import type candidate from "provider";', expected: false, nested: false },
    { code: 'import type candidate = require("provider");', expected: false, nested: false },
    { code: "const candidate = 0;", expected: true, nested: false },
    { code: "let candidate = 0;", expected: true, nested: false },
    { code: "var candidate = 0;", expected: true, nested: false },
    { code: "const candidate = 0; interface candidate {}", expected: true, nested: false },
    { code: "interface candidate {} const candidate = 0;", expected: true, nested: false },
    { code: "const candidate = 0; type candidate = unknown;", expected: true, nested: false },
    { code: "class candidate {} interface candidate {}", expected: true, nested: false },
    { code: "function candidate() {} interface candidate {}", expected: true, nested: false },
    { code: 'import candidate from "provider";', expected: true, nested: false },
    { code: 'import candidate = require("provider");', expected: true, nested: false },
    {
      code: "const candidate = 0; function owner() { interface candidate {} }",
      expected: true,
      nested: true,
    },
    {
      code: "interface candidate {} function owner() { const candidate = 0; }",
      expected: false,
      nested: false,
    },
    {
      code: "declare const candidate: unknown; function owner() { interface candidate {} }",
      expected: false,
      nested: true,
    },
    {
      code: "function owner(candidate: unknown) { interface candidate {} }",
      expected: true,
      nested: true,
    },
    { code: "const unrelated = 0; interface candidate {}", expected: false, nested: false },
  ])("resolves $code", ({ code, expected, nested }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const bindingScope = nested
      ? scopes.rootScope.children.find((scope) => scope.kind === "function")
      : scopes.rootScope;
    const symbol = bindingScope?.symbols.findLast((binding) => binding.name === "candidate");
    expect(symbol).toBeDefined();
    if (!symbol) throw new Error("Missing fixture binding");
    expect(hasRuntimeValueBinding(symbol)).toBe(expected);
    expect(hasRuntimeValueBinding(symbol)).toBe(expected);
  });
});
