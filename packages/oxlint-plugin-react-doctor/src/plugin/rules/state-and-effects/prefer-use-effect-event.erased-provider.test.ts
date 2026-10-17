import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(preferUseEffectEvent, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
