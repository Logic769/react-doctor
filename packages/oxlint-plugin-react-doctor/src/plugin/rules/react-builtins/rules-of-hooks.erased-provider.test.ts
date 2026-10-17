import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: "declare const require: any;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: "declare const require: any;require(\"react-markdown\").default = () => null;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: "interface require {}require(\"react-markdown\").default = () => null;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: "import type require from \"provider-types\";require(\"react-markdown\").default = () => null;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: "declare const globalThis:any;globalThis.require(\"react-markdown\").default = () => null;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: "declare const globalThis:any;const world=globalThis;world.require(\"react-markdown\").default = () => null;import Markdown from 'react-markdown'; import {useState} from 'react'; function View(){return <Markdown components={{'count-item':()=>{const [count]=useState(0);return <span>{count}</span>;}}}/>;}",
    expected: 1,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(rulesOfHooks, scenario.code, { filename: "provider-runtime.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
