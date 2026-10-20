import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const INSTANCE = `import React from "react";
import { Splide as Deck } from "@splidejs/splide";
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.deck.on("ready", () => {});
    this.deck.mount();
  }
  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }
  render() { return null; }
}`;

const IMPORTED_ITERATION = `import React from "react";
import { Splide as Deck } from "@splidejs/splide";
import { subscriptions } from "./event-list";
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.listen(this.deck);
    this.deck.mount();
  }
  listen(owner: Deck) {
    subscriptions.forEach(([eventName, callbackName]) => {
      const callback = this.props[callbackName];
      if (typeof callback === "function") {
        owner.on(eventName, (...values) => callback(owner, ...values));
      }
    });
  }
  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }
  render() { return null; }
}`;

const OPTIONS = {
  filename: "src/GalleryView.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": { capabilities: ["react"], portedRuleMode: "curated" },
  },
};

const QUIET_CASES = [
  { name: "owned completed instance with guarded destroy", code: INSTANCE },
  { name: "ordinary imported synchronous event vector", code: IMPORTED_ITERATION },
  {
    name: "explicit empty null owner field",
    code: INSTANCE.replace("deck: Deck | undefined;", "deck: Deck | null = null;").replace(
      "this.deck = undefined;",
      "this.deck = null;",
    ),
  },
  {
    name: "direct genuine PureComponent",
    code: INSTANCE.replace("extends React.Component", "extends React.PureComponent"),
  },
  {
    name: "direct genuine named Component",
    code: INSTANCE.replace(
      'import React from "react";',
      'import { Component } from "react";',
    ).replace("extends React.Component", "extends Component"),
  },
  {
    name: "erased interface heritage does not add runtime provider uses",
    code: INSTANCE.replace(
      "export class GalleryView",
      "interface DeckView extends Deck {}\nexport class GalleryView",
    ),
  },
];

const WARNING_CASES = [
  {
    name: "explicit return before native mount",
    code: INSTANCE.replace("    this.deck.mount();", "    return;\n    this.deck.mount();"),
  },
  {
    name: "conditional return before native mount",
    code: INSTANCE.replace(
      "    this.deck.mount();",
      "    if (this.props.defer) return;\n    this.deck.mount();",
    ),
  },
  {
    name: "optional immediate this owner alias replacement",
    code: INSTANCE.replace(
      "  render()",
      "  componentDidUpdate() { const current = this?.deck; if (current) current.destroy = () => {}; }\n  render()",
    ),
  },
  { name: "missing native destroy", code: INSTANCE.replace("      this.deck.destroy();\n", "") },
  {
    name: "unrelated release condition",
    code: INSTANCE.replace("if (this.deck)", "if (this.props.release && this.deck)"),
  },
  {
    name: "different instance released",
    code: INSTANCE.replace("this.deck.destroy()", "this.other.destroy()"),
  },
  {
    name: "owner overwritten during update",
    code: INSTANCE.replace(
      "  render()",
      '  componentDidUpdate() { this.deck = new Deck("#other"); }\n  render()',
    ),
  },
  {
    name: "computed owner overwrite",
    code: INSTANCE.replace(
      "  render()",
      '  componentDidUpdate() { this["deck"] = new Deck("#other"); }\n  render()',
    ),
  },
  {
    name: "computed owner clear",
    code: INSTANCE.replace(
      "  render()",
      '  componentDidUpdate() { this["deck"] = undefined; }\n  render()',
    ),
  },
  {
    name: "computed selected method replacement",
    code: INSTANCE.replace(
      "  render()",
      '  componentDidUpdate() { this["deck"].destroy = () => {}; }\n  render()',
    ),
  },
  {
    name: "computed cleanup override",
    code: INSTANCE.replace(
      "export class GalleryView",
      'const cleanupName = "componentWillUnmount";\nexport class GalleryView',
    ).replace("  render()", "  [cleanupName]() {}\n  render()"),
  },
  {
    name: "explicit mount lifecycle reentry",
    code: INSTANCE.replace(
      "  render()",
      "  componentDidUpdate() { this.componentDidMount(); }\n  render()",
    ),
  },
  {
    name: "lifecycle extraction",
    code: INSTANCE.replace(
      "return null;",
      "this.props.take(this.componentWillUnmount.bind(this)); return null;",
    ),
  },
  {
    name: "repeated acquisition in a loop",
    code: INSTANCE.replace(
      '    this.deck = new Deck("#gallery");',
      '    for (const selector of ["#one", "#two"]) { this.deck = new Deck(selector);',
    ).replace("    this.deck.mount();", "    this.deck.mount(); }"),
  },
  {
    name: "repeated acquisition in an eager callback",
    code: INSTANCE.replace(
      '    this.deck = new Deck("#gallery");',
      '    ["#one", "#two"].forEach(selector => { this.deck = new Deck(selector);',
    ).replace("    this.deck.mount();", "    this.deck.mount(); });"),
  },
  {
    name: "secondary deferred registration",
    code: IMPORTED_ITERATION.replace(
      "owner.on(eventName, (...values) => callback(owner, ...values));",
      'owner.on(eventName, (...values) => callback(owner, ...values)); setTimeout(() => owner.on("later", () => {}), 0);',
    ),
  },
  {
    name: "second owner on AST remains unsupported",
    code: INSTANCE.replace(
      "    this.deck.mount();",
      '    this.deck.on("move", () => {}); this.deck.mount();',
    ),
  },
  {
    name: "visible imported iterator deferral",
    code: IMPORTED_ITERATION.replace(
      "export class GalleryView",
      "subscriptions.forEach = visit => { setTimeout(() => visit(subscriptions[0]), 0); };\nexport class GalleryView",
    ),
  },
  {
    name: "iterator descriptor replacement",
    code: IMPORTED_ITERATION.replace(
      "export class GalleryView",
      'Object.defineProperty(subscriptions, "forEach", { value: visit => { setTimeout(() => visit(subscriptions[0]), 0); } });\nexport class GalleryView',
    ),
  },
  {
    name: "native prototype iterator replacement",
    code: IMPORTED_ITERATION.replace(
      "export class GalleryView",
      "Array.prototype.forEach = function(visit) { setTimeout(() => visit(this[0]), 0); };\nexport class GalleryView",
    ),
  },
  {
    name: "window native prototype replacement",
    code: IMPORTED_ITERATION.replace(
      "export class GalleryView",
      "window.Array.prototype.forEach = function(visit) { setTimeout(() => visit(this[0]), 0); };\nexport class GalleryView",
    ),
  },
  {
    name: "local superclass can shadow cleanup",
    code: INSTANCE.replace(
      "export class GalleryView extends React.Component",
      'const cleanupName = "componentWillUnmount";\nclass Component extends React.Component { constructor(...values) { super(...values); this[cleanupName] = () => {}; } }\nexport class GalleryView extends Component',
    ),
  },
  {
    name: "secondary canonical constructor alias",
    code: INSTANCE.replace(
      "export class GalleryView",
      'import { Splide as OtherDeck } from "@splidejs/splide";\nOtherDeck.prototype.destroy = () => {};\nexport class GalleryView',
    ),
  },
  {
    name: "runtime native module loader",
    code: INSTANCE.replace(
      "export class GalleryView",
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url); load("@splidejs/splide").Splide.prototype.destroy = () => {};\nexport class GalleryView',
    ),
  },
  {
    name: "dynamic secondary provider",
    code: INSTANCE.replace(
      "export class GalleryView",
      'import("@splidejs/splide").then(namespace => { namespace.Splide.prototype.destroy = () => {}; });\nexport class GalleryView',
    ),
  },
  {
    name: "process builtin loader",
    code: INSTANCE.replace(
      "export class GalleryView",
      'const load = process.getBuiltinModule("module");\nexport class GalleryView',
    ),
  },
  {
    name: "constructor member transport",
    code: INSTANCE.replace(
      "export class GalleryView",
      "const makeFunction = [].constructor.constructor;\nexport class GalleryView",
    ),
  },
  {
    name: "constructor pattern transport",
    code: INSTANCE.replace(
      "export class GalleryView",
      "const { constructor: create } = [];\nexport class GalleryView",
    ),
  },
  {
    name: "constructor provider replaced",
    code: INSTANCE.replace(
      "export class GalleryView",
      "Deck.prototype.destroy = () => {};\nexport class GalleryView",
    ),
  },
  {
    name: "owner passed to unrelated code",
    code: INSTANCE.replace(
      "    this.deck.mount();",
      "    this.props.take(this.deck); this.deck.mount();",
    ),
  },
  {
    name: "owner native method extraction",
    code: INSTANCE.replace("  render()", "  take() { return this.deck.destroy; }\n  render()"),
  },
  {
    name: "async unmount",
    code: INSTANCE.replace("  componentWillUnmount()", "  async componentWillUnmount()"),
  },
  {
    name: "wrong carousel provider",
    code: INSTANCE.replace('from "@splidejs/splide"', 'from "other-carousel"'),
  },
];

describe.each([
  { mode: "direct", rule: classComponentMissingComponentWillUnmountTeardown },
  {
    mode: "semantic wrapper",
    rule: wrapWithSemanticContext(classComponentMissingComponentWillUnmountTeardown),
  },
])("owned Splide listener teardown ($mode)", ({ rule }) => {
  it.each(QUIET_CASES)("accepts $name", ({ code }) => {
    const result = runRule(rule, code, OPTIONS);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(WARNING_CASES)("preserves warning for $name", ({ code }) => {
    const result = runRule(rule, code, OPTIONS);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a later unrelated listener hazard", () => {
    const code = INSTANCE.replace(
      "    this.deck.mount();",
      '    this.deck.mount();\n    this.notifications.on("change", () => {});',
    );
    const result = runRule(rule, code, OPTIONS);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(
      code.split("\n").findIndex((line) => line.includes("this.notifications.on")) + 1,
    );
  });
});
