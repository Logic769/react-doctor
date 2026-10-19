import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

const controls = [
  {
    name: "total branch assigned native listener",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "both branch functions contain stale toggle",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "functional updater branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen((previous) => !previous); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "ordinary click branch has no deferred registration",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  let listener;\n  if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n  return <button onClick={listener}>Toggle</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "overwritten before registration",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    listener = () => {};\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "registered before branches assign",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    target.addEventListener("change", listener);\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "shadowed branch binding is not registered outer binding",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { const listener = () => setOpen(!open); void listener; } else { const listener = () => setOpen(!open); void listener; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state dependency and matching cleanup refresh closure",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target, open]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal dead branch never supplies registered stale function",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (false) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "initial true state never selects stale else",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "render phase changes predicate before effects",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  if (mode) setMode(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "render helper changes predicate before effects",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const reset = () => setMode(false);\n  if (mode) reset();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "known const predicate selects harmless branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const selected = true;\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "defaulted helper predicate called without argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const install = (selected = true) => {\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n    };\n    return install();\n  }, [target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "mutated object destructuring selects harmless branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const settings = { selected: false };\n    settings.selected = true;\n    const { selected } = settings;\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "direct eval rewrites otherwise readonly predicate",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    eval("mode = true");\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "registration getter replaces callback before reading argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const native = new EventTarget();\n    const target = { get addEventListener() { listener = () => {}; return native.addEventListener.bind(native); }, removeEventListener: native.removeEventListener.bind(native) };\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "loop later overwrites selected callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    for (const selected of [false, true]) { if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); } }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "event operand replaces handler before callback argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener((listener = () => {}, "change"), listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "initial false state with ordinary event setter",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "native target local constructor",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "known factory returns synchronous imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const createTarget = () => ({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n    const target = createTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "different state operand remains excluded",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!mode); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state dependency without cleanup does not refresh safely",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n\n  }, [mode, target, open]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "latest ref guard remains excluded",
    code: 'import { useEffect, useState, useRef } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  const latest = useRef(open);\n  latest.current = open;\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => { if (latest.current === open) setOpen(!open); }; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state seed is synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target] = useState({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state replaced by synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  const initialize = () => setTarget({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={initialize}>{String(open)}</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state seed alias is synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const imitation = { addEventListener(event, callback) { callback(); }, removeEventListener() {} };\n  const [target] = useState(imitation);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "whole parameter default is fixed by omitted caller argument",
    code: 'import { useEffect, useState } from "react";\nconst native = new EventTarget();\nconst useExample = ({ mode, target } = { mode: true, target: native }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return open;\n};\nexport const Example = () => <output>{String(useExample())}</output>;\n',
    diagnostics: [],
  },
  {
    name: "synchronous callback taking helper flips predicate during render",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const invoke = (callback) => callback();\n  if (mode) invoke(() => setMode(false));\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal null receiver cannot retain callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = null;\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal text receiver cannot retain callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = "text";\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state with unused setter has no native target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state only receives null",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  const reset = () => setTarget(null);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={reset}>{String(open)}</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "native method explicitly replaced with synchronous imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    target.addEventListener = (event, callback) => callback();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null seed state receives local native target and seed selected listener",
    code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "stored JSX handler invoked during render",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const button = <button onClick={() => setMode(false)} />;\n  if (mode) button.props.onClick();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return button;\n};\n',
    diagnostics: [],
  },
  {
    name: "native global constructor explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nEventTarget = class { addEventListener(event, callback) { callback(); } removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "namespace native constructor explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nwindow.EventTarget = class { addEventListener(event, callback) { callback(); } removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic undefined is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    undefined.addEventListener("change", listener);\n    return () => undefined.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic NaN is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    NaN.addEventListener("change", listener);\n    return () => NaN.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic Infinity is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    Infinity.addEventListener("change", listener);\n    return () => Infinity.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "visible reflected native method replacement",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  Object.defineProperty(target, "addEventListener", { value(event, callback) { callback(); } });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "visible assigned native method replacement",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  Object.assign(target, { addEventListener(event, callback) { callback(); } });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "const computed native method explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  const method = "addEventListener";\n  target[method] = (event, callback) => callback();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "selected global event target explicitly reassigned",
    code: 'import { useEffect, useState } from "react";\nself = { addEventListener(event, callback) { callback(); }, removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    self.addEventListener("change", listener);\n    return () => self.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "TypeScript wrapped direct eval fixes branch predicate before listener assignment",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    (eval as any)("mode = true");\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
];

describe("no-boolean-toggle-without-functional-update — closed local branch listeners", () => {
  it.each(controls)("$name", ({ code, diagnostics }) => {
    expect(runRule(noBooleanToggleWithoutFunctionalUpdate, code)).toEqual({
      diagnostics,
      parseErrors: [],
    });
  });
});
