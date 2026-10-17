import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { unsafeJsonInHtml } from "./unsafe-json-in-html.js";

interface HtmlSinkAttributionCase {
  readonly name: string;
  readonly code: string;
  readonly relativePath: string;
  readonly expectedLocations: readonly (readonly number[])[];
}

const cases: readonly HtmlSinkAttributionCase[] = [
  {
    name: "closed-static-attribute-before-unrelated-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const serialized = JSON.stringify(payload);',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "closed-static-attribute-before-later-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 26]],
  },
  {
    name: "closed-static-attribute-before-ordinary-jsx-prop",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} title={JSON.stringify(payload)} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "closed-static-attribute-before-react-text-child",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const text = <output>{JSON.stringify(payload)}</output>;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-static-object-before-unrelated-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: makeText({ nested: { count: 1 } }) }} />;\nexport const serialized = JSON.stringify(payload);",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "quoted-closing-braces-before-unrelated-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "}}" }} />;\nexport const serialized = JSON.stringify(payload);',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "template-closing-braces-before-unrelated-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: `}}` }} />;\nexport const serialized = JSON.stringify(payload);",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "regex-closing-braces-before-own-serialization",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: /}}/.test(label) ? JSON.stringify(payload) : "" }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "nested-template-before-own-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: `prefix ${makeText(`}`)} ${JSON.stringify(payload)}` }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "comment-closing-braces-before-own-serialization",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: /* }} */ JSON.stringify(payload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "two-dynamic-attributes",
    code: "export const first = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(firstPayload) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(secondPayload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [
      [1, 27],
      [2, 28],
    ],
  },
  {
    name: "static-json-before-dynamic-attribute",
    code: 'export const first = <div dangerouslySetInnerHTML={{ __html: JSON.stringify({ "count": 1 }) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
  {
    name: "escaped-json-before-dynamic-attribute",
    code: "export const first = <div dangerouslySetInnerHTML={{ __html: escapeHtml(JSON.stringify(payload)) }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;",
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
  {
    name: "two-static-attributes-before-dynamic-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const middle = <div dangerouslySetInnerHTML={{ __html: "More" }} />;\nexport const last = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[3, 26]],
  },
  {
    name: "earlier-static-attribute-does-not-hide-return-escaped-later-sink",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload).replaceAll("<", "\\u003c") }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "commented-out-attribute-before-dynamic-attribute",
    code: '// <div dangerouslySetInnerHTML={{ __html: "Ready" }} />\nexport const view = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 26]],
  },
  {
    name: "unicode-before-static-and-dynamic-attributes",
    code: 'export const label = "🌱";\nexport const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[3, 26]],
  },
  {
    name: "whitespace-and-comments-between-closed-attributes",
    code: 'export const first = <div dangerouslySetInnerHTML={{\n __html: "Ready",\n}} />;\n/* marker */\nexport const second = <div dangerouslySetInnerHTML={{\n __html: JSON.stringify(payload),\n}} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[5, 28]],
  },
  {
    name: "non-html-attribute-serialization-after-static-sink",
    code: 'export const view = <section><div dangerouslySetInnerHTML={{ __html: "Ready" }} /><output data-value={JSON.stringify(payload)} /></section>;',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "call-after-closed-static-attribute",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nconsume(JSON.stringify(payload));',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "preserves-inline-script-interpolation",
    code: "export const html = `<script>const value = ${JSON.stringify(payload)};</script>`;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 22]],
  },
  {
    name: "preserves-inline-script-runtime-serialization",
    code: "export const html = `<script>const value = JSON.stringify(payload);</script>`;",
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "preserves-unparseable-input-fallback",
    code: "export const view = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;\nconst unfinished =",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 26]],
  },
  {
    name: "preserves-template-markup-fallback",
    code: "export const html = `<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />`;",
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 27]],
  },
  {
    name: "preserves-non-source-path-gate",
    code: "<div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />",
    relativePath: "src/view.html",
    expectedLocations: [],
  },
  {
    name: "closed-attribute-before-outside-argument-with-braces",
    code: 'export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;\nexport const serialized = JSON.stringify({ nested: payload });',
    relativePath: "src/view.tsx",
    expectedLocations: [],
  },
  {
    name: "nested-jsx-attributes-keep-their-own-owner",
    code: 'export const view = <section title={<div dangerouslySetInnerHTML={{ __html: "Ready" }} />}><div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} /></section>;',
    relativePath: "src/view.tsx",
    expectedLocations: [[1, 97]],
  },
  {
    name: "empty-html-before-dynamic-attribute",
    code: 'export const first = <div dangerouslySetInnerHTML={{ __html: "" }} />;\nexport const second = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;',
    relativePath: "src/view.tsx",
    expectedLocations: [[2, 28]],
  },
];

describe("unsafe-json-in-html sink attribution", () => {
  it.each(cases)("$name", ({ code, relativePath, expectedLocations }) => {
    const findings = runScanRule(unsafeJsonInHtml, { content: code, relativePath });
    expect(findings.map(({ line, column }) => [line, column])).toEqual(expectedLocations);
  });
});
