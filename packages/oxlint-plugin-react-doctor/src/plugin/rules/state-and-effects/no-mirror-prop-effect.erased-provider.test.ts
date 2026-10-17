import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noMirrorPropEffect, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
