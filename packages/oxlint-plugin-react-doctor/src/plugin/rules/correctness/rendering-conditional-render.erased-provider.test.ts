import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useState = () => [0, () => {}];import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useState = () => [0, () => {}];import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useState = () => [0, () => {}];import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useState = () => [0, () => {}];import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useState = () => [0, () => {}];import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "rejects erased native tuple provider writes",
    code: 'declare const Array:any; declare const Symbol:any;Array.prototype[Symbol.iterator] = function* () { yield 0; yield () => {}; };import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(renderingConditionalRender, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
