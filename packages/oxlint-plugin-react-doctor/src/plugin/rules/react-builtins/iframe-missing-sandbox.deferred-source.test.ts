import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { computeSourceProjectFingerprint } from "../../utils/compute-source-project-fingerprint.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";
import { createDeferredIframeSourceChecker } from "./utils/create-deferred-iframe-source-checker.js";

interface FixtureChange {
  readonly before: string;
  readonly after: string;
}

interface DeferredIframeCase {
  readonly name: string;
  readonly source: string;
  readonly files: Readonly<Record<string, string>>;
  readonly certificate: boolean;
}

const certificateProbe: Rule = {
  id: "deferred-iframe-source-probe",
  severity: "warn",
  create: (context) => {
    const matches = createDeferredIframeSourceChecker(context);
    return {
      JSXOpeningElement: (node) => {
        if (matches(node)) context.report({ node, message: "possible deferred external source" });
      },
    };
  },
};

const withFixtureChanges = (source: string, changes: ReadonlyArray<FixtureChange>): string => {
  let result = source;
  for (const change of changes) {
    if (
      !change.before ||
      !result.includes(change.before) ||
      result.indexOf(change.before) !== result.lastIndexOf(change.before)
    ) {
      throw new Error(`Fixture change must select one exact occurrence: ${change.before}`);
    }
    result = result.replace(change.before, () => change.after);
  }
  return result;
};

const NATIVE_SOURCE = `import React, { useRef } from 'react';
export const Preview = () => {
  const frame = useRef(null);
  const open = () => {
    const container = document.querySelector('#preview');
    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');
  };
  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;
};
`;

const WRAPPER_SOURCE = `import React, { useRef } from 'react';
import { Shell, Body, Action } from './frame';
export const Preview = () => {
  const frame = useRef(null);
  const open = () => {
    const container = document.querySelector('#preview');
    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');
  };
  return <Shell id="preview"><Body><iframe ref={frame}/></Body><Action onClick={open}>Open</Action></Shell>;
};
`;

const PROJECTION_SOURCE = `import React, {useRef} from 'react';
import {Shell, Body} from './frame';
const Launch = ({entry}) => {
  const open = () => {
    const container = document.querySelector(\`#clip_\${entry.id}\`);
    container.querySelector('.clip-body > iframe').setAttribute('src', 'https://media.example/embed/' + entry.clip);
  };
  return <button onClick={open}>Open</button>;
};
const Preview = ({entry}) => {
  const frameRef = useRef(null);
  const close = () => frameRef.current.setAttribute('src', '');
  return <Shell id={\`clip_\${entry.id}\`}><Body onClose={close}><iframe ref={frameRef} title="Preview" /></Body></Shell>;
};
export const Gallery = ({entries}) => <>{entries.map(entry => <Launch entry={entry}/>)}{entries.map(entry => <Preview entry={entry}/>)}</>;
`;

const ASYNC_PROJECTION_SOURCE = `import React, { useRef } from "react";
import { FrameBody, Panel } from "./frame-panel";
const Launcher = ({ entry }) => {
  const open = async () => {
    const container = document.querySelector(\`#preview_\${entry.id}\`);
    const clips = await loadClips(entry.id);
    if (clips.length) {
      const source = "https://media.example/embed/" + clips[0].key;
      container.querySelector(".frame-body > iframe").setAttribute("src", source);
    } else {
      container.querySelector(".frame-body").innerHTML = "No clip";
    }
  };
  return <button onClick={open}>Preview</button>;
};
const Preview = ({ entry }) => {
  const frameRef = useRef(null);
  const close = () => frameRef.current.setAttribute("src", "");
  return <Panel id={\`preview_\${entry.id}\`}><FrameBody onClose={close}><iframe ref={frameRef} title="Preview" /></FrameBody></Panel>;
};
export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;
`;

const WRAPPER_MODULE = `import React from 'react';
import PropTypes from 'prop-types';
export const Shell = props => <div id={props.id}>{props.children}</div>;
export const Body = props => <div className="carrier">{props.children}</div>;
const Button = props => <button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</button>;
Button.propTypes = {onClick: PropTypes.func};
export const Action = props => <Button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</Button>;
`;

const PROJECTION_MODULE = `import React from 'react';
export const Shell = props => <div id={props.id}>{props.children}</div>;
export const Body = props => <div className="clip-body">{props.children}<button onClick={props.onClose}>Close</button></div>;
`;

const ASYNC_PROJECTION_MODULE = `import React from "react";
export const Panel = props => <div id={props.id}>{props.children}</div>;
export const FrameBody = props => <div className="frame-body">{props.children}<button onClick={props.onClose}>Close</button></div>;
`;

const cases: ReadonlyArray<DeferredIframeCase> = [
  {
    name: "direct native div and executable button",
    source: NATIVE_SOURCE,
    files: {},
    certificate: true,
  },
  {
    name: "renamed native carrier and id",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after:
          "    const container = document.querySelector('#screen');\n    container.querySelector('.content-slot > iframe').setAttribute('src', 'https://media.example/video');\n",
      },
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="screen"><div className="content-slot"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: true,
  },
  {
    name: "readonly external prefix plus data suffix",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "export const Preview = () => {\n",
        after: "export const Preview = ({record}) => {\n",
      },
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/embed/' + record.key);\n",
      },
    ]),
    files: {},
    certificate: true,
  },
  {
    name: "two conditional callback forwarding hops and static metadata",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": WRAPPER_MODULE,
    },
    certificate: true,
  },
  {
    name: "native default React StrictMode mount",
    source: NATIVE_SOURCE,
    files: {
      "src/index.tsx": withFixtureChanges(PROJECTION_MODULE, [
        {
          before:
            "import React from 'react';\nexport const Shell = props => <div id={props.id}>{props.children}</div>;\nexport const Body = props => <div className=\"clip-body\">{props.children}<button onClick={props.onClose}>Close</button></div>;\n",
          after:
            "import React from 'react'; import ReactDOM from 'react-dom'; import {Preview} from './preview'; ReactDOM.render(<React.StrictMode><Preview/></React.StrictMode>, document.getElementById('app'));",
        },
      ]),
    },
    certificate: true,
  },
  {
    name: "ordinary native document listener",
    source: NATIVE_SOURCE,
    files: {
      "src/listener.ts":
        "const listen = event => console.log(event.key); document.addEventListener('keyup', listen); document.removeEventListener('keyup', listen);",
    },
    certificate: true,
  },
  {
    name: "unused writer has no executable invoker",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "void writer read is not an executable use",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  void open;\n  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "statically inactive invocation",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  if (false) open();\n  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "statically inactive event expression",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={false ? open : undefined}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "unknown custom event sink",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "import React, { useRef } from 'react';\n",
        after: "import Opaque from 'opaque';\nimport React, { useRef } from 'react';\n",
      },
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><Opaque onClick={open}/></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "wrapper drops callback",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before:
            "const Button = props => <button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</button>;\n",
          after: "const Button = props => <button >{props.children}</button>;\n",
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "wrapper escapes children object",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before: 'export const Body = props => <div className="carrier">{props.children}</div>;\n',
          after:
            'export const Body = props => { drop(props); return <div className="carrier">{props.children}</div>; };\n',
        },
        {
          before:
            "export const Action = props => <Button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</Button>;\n",
          after:
            "export const Action = props => <Button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</Button>;\n\nconst drop = value => { value.children = null; };",
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "wrapper native callback ref destroys descendants",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before: 'export const Body = props => <div className="carrier">{props.children}</div>;\n',
          after:
            'export const Body = props => <div className="carrier" ref={node => { if(node) node.textContent = ""; }}>{props.children}</div>;\n',
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "void forwarding host",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before: 'export const Body = props => <div className="carrier">{props.children}</div>;\n',
          after:
            'export const Body = props => <input className="carrier">{props.children}</input>;\n',
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "custom element forwarding host",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before: 'export const Body = props => <div className="carrier">{props.children}</div>;\n',
          after:
            'export const Body = props => <x-carrier className="carrier">{props.children}</x-carrier>;\n',
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "customized built-in host",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div is="custom-carrier" className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "section outer host is outside finite div contract",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <section id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></section>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "unrelated literal container",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    const container = document.querySelector('#preview');\n",
        after: "    const container = document.querySelector('#other');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "earlier sibling with same id has no matching iframe",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div><div id="preview"><span>Earlier unrelated container</span></div><div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "static HTML same id",
    source: NATIVE_SOURCE,
    files: {
      "public/index.html": '<main id="preview"></main>',
    },
    certificate: false,
  },
  {
    name: "HTML iframe origin uncertainty",
    source: NATIVE_SOURCE,
    files: {
      "public/index.html": "<iframe></iframe>",
    },
    certificate: false,
  },
  {
    name: "same carrier rival iframe",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><div className="carrier"><iframe/></div><button onClick={open}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "handler erases selected children before its source query",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    const container = document.querySelector('#preview');\n",
        after:
          "    document.getElementById('preview').innerHTML = '';\n    const container = document.querySelector('#preview');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "string timer creates DOM source",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "  const frame = useRef(null);\n",
        after:
          '  setTimeout(\'document.querySelector("#preview").prepend(document.createElement("iframe"))\', 0);\n  const frame = useRef(null);\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "selected ref escape",
    source: withFixtureChanges(NATIVE_SOURCE, [
      { before: "  const open = () => {\n", after: "  consume(frame);\n  const open = () => {\n" },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "callback native iframe ref",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe ref={node => { frame.current = node; }}/></div><button onClick={open}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "opaque URL is unsupported",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after: "    container.querySelector('.carrier > iframe').setAttribute('src', getUrl());\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "empty clear is not external source",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after: "    container.querySelector('.carrier > iframe').setAttribute('src', '');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "relative URL remains unsupported",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after: "    container.querySelector('.carrier > iframe').setAttribute('src', '/local');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "source setter alias is unsupported",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after:
          "    const setter = container.querySelector('.carrier > iframe').setAttribute; setter('src', 'https://media.example/video');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "native provider overridden",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "  const frame = useRef(null);\n",
        after: "  document.querySelector = () => null;\n  const frame = useRef(null);\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "type shadowed native provider",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "export const Preview = () => {\n",
        after: "interface document {}\nexport const Preview = () => {\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "React callback API extraction",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "  const frame = useRef(null);\n",
        after: "  const clone = React.cloneElement;\n  const frame = useRef(null);\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "named React factory capability",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n",
        after:
          "import React, { useRef, createElement } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n\ncreateElement(\"iframe\");",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "result consumed by React cloning",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n",
        after:
          "import React, { useRef } from 'react';\nconst Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n\nexport const Wrapped = () => React.cloneElement(Preview(), {});",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "spread may alter native element",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          '  return <div id="preview"><div className="carrier"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
        after:
          '  return <div id="preview"><div className="carrier"><iframe {...extra} ref={frame}/></div><button onClick={open}>Open</button></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "statically inactive source writer",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
        after:
          "    if (false) container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "computed provider selector access",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    const container = document.querySelector('#preview');\n",
        after: "    const container = document['querySelector']('#preview');\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "cross-file ref provider mutation",
    source: NATIVE_SOURCE,
    files: {
      "src/other.ts": "import React from 'react'; React.useRef = () => ({current:null});",
    },
    certificate: false,
  },
  {
    name: "cross-file DOM origin insertion",
    source: NATIVE_SOURCE,
    files: {
      "src/other.ts": "document.body.appendChild(document.createElement('iframe'));",
    },
    certificate: false,
  },
  {
    name: "CJS dynamic loader remains unsupported",
    source: NATIVE_SOURCE,
    files: {
      "src/other.js": "const root = require('react');",
    },
    certificate: false,
  },
  {
    name: "div counterpart: permanently unmatched outer id refuses positive container proof",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before: "    const container = document.querySelector(`#preview_${entry.id}`);\n",
        after: '    const container = document.querySelector("#absent-container");\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: read-only matched literal root id permits finite positive arm",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before: "    const container = document.querySelector(`#preview_${entry.id}`);\n",
        after: '    const container = document.querySelector("#preview-fixed");\n',
      },
      {
        before:
          '  return <Panel id={`preview_${entry.id}`}><FrameBody onClose={close}><iframe ref={frameRef} title="Preview" /></FrameBody></Panel>;\n',
        after:
          '  return <Panel id="preview-fixed"><FrameBody onClose={close}><iframe ref={frameRef} title="Preview" /></FrameBody></Panel>;\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: true,
  },
  {
    name: "div counterpart: disjoint template prefix refuses container witness",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before: "    const container = document.querySelector(`#preview_${entry.id}`);\n",
        after: "    const container = document.querySelector(`#different_${entry.id}`);\n",
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: unknown children supplied at another carrier use refuses origin census",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before:
          "export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n",
        after:
          "export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n\nexport const UnknownCarrier = ({children}) => <FrameBody>{children}</FrameBody>;\n",
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: another iframe can acquire matching class through visible mutation",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before:
          "export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n",
        after:
          'export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n\nconst alternate = document.querySelector(".different"); alternate.classList.add("frame-body");\nexport const Other = () => <div className="different"><iframe title="Other" /></div>;\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: matching static HTML iframe is a rival origin",
    source: ASYNC_PROJECTION_SOURCE,
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
      "public/index.html":
        '<div id="preview-fixed"><div class="frame-body"><iframe title="Other"></iframe></div></div>',
    },
    certificate: false,
  },
  {
    name: "div counterpart: native construction of a competing iframe refuses negative origin facts",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before:
          "export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n",
        after:
          'export const Gallery = ({ entries }) => <>{entries.map(entry => <Launcher entry={entry} />)}{entries.map(entry => <Preview entry={entry} />)}</>;\n\nconst injected = document.createElement("iframe"); document.querySelector(".frame-body").append(injected);\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: wrapper clone changes children rather than forwarding them",
    source: ASYNC_PROJECTION_SOURCE,
    files: {
      "src/frame-panel.tsx": withFixtureChanges(ASYNC_PROJECTION_MODULE, [
        {
          before:
            'export const FrameBody = props => <div className="frame-body">{props.children}<button onClick={props.onClose}>Close</button></div>;\n',
          after:
            'export const FrameBody = props => <div className="frame-body">{React.cloneElement(props.children, {ref: publish})}<button onClick={props.onClose}>Close</button></div>;\n',
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "div counterpart: inert same-module prop types metadata does not imply wrapper replacement",
    source: ASYNC_PROJECTION_SOURCE,
    files: {
      "src/frame-panel.tsx": withFixtureChanges(ASYNC_PROJECTION_MODULE, [
        {
          before: 'import React from "react";\n',
          after: 'import PropTypes from "prop-types";\nimport React from "react";\n',
        },
        {
          before:
            'export const FrameBody = props => <div className="frame-body">{props.children}<button onClick={props.onClose}>Close</button></div>;\n',
          after:
            'export const FrameBody = props => <div className="frame-body">{props.children}<button onClick={props.onClose}>Close</button></div>;\n\nFrameBody.propTypes = {onClose: PropTypes.func};\n',
        },
      ]),
    },
    certificate: true,
  },
  {
    name: "div counterpart: callback ref transport cannot be treated as private useRef",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before:
          '  return <Panel id={`preview_${entry.id}`}><FrameBody onClose={close}><iframe ref={frameRef} title="Preview" /></FrameBody></Panel>;\n',
        after:
          '  return <Panel id={`preview_${entry.id}`}><FrameBody onClose={close}><iframe ref={node => publish(node)} title="Preview" /></FrameBody></Panel>;\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: empty source clearing alone remains blank-frame fallback",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before: '      const source = "https://media.example/embed/" + clips[0].key;\n',
        after: '      const source = "";\n',
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "div counterpart: unsupported opaque source value remains fallback",
    source: withFixtureChanges(ASYNC_PROJECTION_SOURCE, [
      {
        before: '      const source = "https://media.example/embed/" + clips[0].key;\n',
        after: "      const source = readSource(clips);\n",
      },
    ]),
    files: {
      "src/frame-panel.tsx": ASYNC_PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "projection: common projection plus direct native wrapper path",
    source: PROJECTION_SOURCE,
    files: {
      "src/frame.tsx": PROJECTION_MODULE,
    },
    certificate: true,
  },
  {
    name: "projection: same spelling but unrelated collection origin",
    source: withFixtureChanges(PROJECTION_SOURCE, [
      {
        before:
          "export const Gallery = ({entries}) => <>{entries.map(entry => <Launch entry={entry}/>)}{entries.map(entry => <Preview entry={entry}/>)}</>;\n",
        after:
          "export const Gallery = ({entries, otherEntries}) => <>{entries.map(entry => <Launch entry={entry}/>)}{otherEntries.map(entry => <Preview entry={entry}/>)}</>;\n",
      },
    ]),
    files: {
      "src/frame.tsx": PROJECTION_MODULE,
    },
    certificate: false,
  },
  {
    name: "projection: extra native wrapper breaks direct child selector",
    source: PROJECTION_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(PROJECTION_MODULE, [
        {
          before:
            'export const Body = props => <div className="clip-body">{props.children}<button onClick={props.onClose}>Close</button></div>;\n',
          after:
            'export const Body = props => <div className="clip-body"><section>{props.children}</section><button onClick={props.onClose}>Close</button></div>;\n',
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "projection: id forwarded from another prop",
    source: PROJECTION_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(PROJECTION_MODULE, [
        {
          before: "export const Shell = props => <div id={props.id}>{props.children}</div>;\n",
          after:
            "export const Shell = props => <div id={props.alternateId}>{props.children}</div>;\n",
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "same collection projections with two conditional onClick forwarding hops",
    source: withFixtureChanges(PROJECTION_SOURCE, [
      {
        before: "import {Shell, Body} from './frame';\n",
        after: "import {Shell, Body, Action} from './frame';\n",
      },
      {
        before: "  return <button onClick={open}>Open</button>;\n",
        after: "  return <Action onClick={open}>Open</Action>;\n",
      },
    ]),
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        { before: "import PropTypes from 'prop-types';\n", after: "" },
        {
          before: 'export const Body = props => <div className="carrier">{props.children}</div>;\n',
          after:
            'export const Body = props => <div className="clip-body">{props.children}<button onClick={props.onClose}>Close</button></div>;\n',
        },
        { before: "Button.propTypes = {onClick: PropTypes.func};\n", after: "" },
      ]),
    },
    certificate: true,
  },
  {
    name: "private intermediate caller also has no executable invoker",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n",
        after:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  const never = () => open();\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button >Open</button></div>;\n};\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "custom callback wrapper throws before forwarding",
    source: WRAPPER_SOURCE,
    files: {
      "src/frame.tsx": withFixtureChanges(WRAPPER_MODULE, [
        {
          before:
            "import React from 'react';\nimport PropTypes from 'prop-types';\nexport const Shell = props => <div id={props.id}>{props.children}</div>;\nexport const Body = props => <div className=\"carrier\">{props.children}</div>;\nconst Button = props => <button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</button>;\nButton.propTypes = {onClick: PropTypes.func};\nexport const Action = props => <Button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</Button>;\n",
          after:
            "import React from 'react';\nimport PropTypes from 'prop-types';\nexport const Shell = props => <div id={props.id}>{props.children}</div>;\nexport const Body = props => <div className=\"carrier\">{props.children}</div>;\nconst Button = props => <button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</button>;\nButton.propTypes = {onClick: PropTypes.func};\nexport const Action = props => { throw null; return <Button onClick={props.onClick ? () => props.onClick() : null}>{props.children}</Button>; };\n",
        },
      ]),
    },
    certificate: false,
  },
  {
    name: "unconditional carrier erasure precedes source assignment",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n",
        after:
          "import React, { useRef } from 'react';\nexport const Preview = () => {\n  const frame = useRef(null);\n  const open = () => {\n    const container = document.querySelector('#preview');\n    container.querySelector('.carrier').innerHTML = '';\n    container.querySelector('.carrier > iframe').setAttribute('src', 'https://media.example/video');\n  };\n  return <div id=\"preview\"><div className=\"carrier\"><iframe ref={frame}/></div><button onClick={open}>Open</button></div>;\n};\n",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "private Preview is preceded by a different empty sibling in Screen",
    source: withFixtureChanges(NATIVE_SOURCE, [
      { before: "export const Preview", after: "const Preview" },
      {
        before: "\n};\n",
        after:
          '\n};\nexport const Screen = () => <div><div id="preview"><span>Earlier empty root</span></div><Preview/></div>;\n',
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "same collection template ids already belong to earlier empty roots",
    source: withFixtureChanges(PROJECTION_SOURCE, [
      {
        before: "export const Gallery = ({entries}) => <>",
        after:
          "export const Gallery = ({entries}) => <>{entries.map(entry => <div id={`clip_${entry.id}`} />)}",
      },
    ]),
    files: { "src/frame.tsx": PROJECTION_MODULE },
    certificate: false,
  },
  {
    name: "literal earlier root collides with a known template id",
    source: withFixtureChanges(PROJECTION_SOURCE, [
      {
        before:
          "export const Gallery = ({entries}) => <>{entries.map(entry => <Launch entry={entry}/>)}{entries.map(entry => <Preview entry={entry}/>)}</>;",
        after:
          'export const Gallery = () => { const entries = [{id: 1}]; return <><div id="clip_1"/>{entries.map(entry => <Launch entry={entry}/>)}{entries.map(entry => <Preview entry={entry}/>)}</>; };',
      },
    ]),
    files: { "src/frame.tsx": PROJECTION_MODULE },
    certificate: false,
  },
  {
    name: "unquoted static HTML id precedes the native container",
    source: NATIVE_SOURCE,
    files: { "public/index.html": "<div id=preview></div>" },
    certificate: false,
  },
  {
    name: "character reference in static HTML id names the selected container",
    source: NATIVE_SOURCE,
    files: { "public/index.html": '<div id="pre&#118;iew"></div>' },
    certificate: false,
  },
  {
    name: "unknown earlier id provider refuses uniqueness",
    source: withFixtureChanges(PROJECTION_SOURCE, [
      {
        before: "export const Gallery = ({entries}) => <>",
        after: "export const Gallery = ({entries, otherId}) => <><div id={otherId}/>",
      },
    ]),
    files: { "src/frame.tsx": PROJECTION_MODULE },
    certificate: false,
  },
  {
    name: "computed route data is consumed only as template text",
    source: NATIVE_SOURCE,
    files: {
      "src/routes.ts":
        "const names = { films: 'films' }; export const route = kind => `/${names[kind]}/list`;",
    },
    certificate: true,
  },
  {
    name: "computed route data used as a function remains unsupported",
    source: NATIVE_SOURCE,
    files: {
      "src/routes.ts":
        "const names = { films: () => 'films' }; export const route = kind => names[kind]();",
    },
    certificate: false,
  },
  {
    name: "tagged template can receive a computed function value",
    source: NATIVE_SOURCE,
    files: {
      "src/routes.ts":
        "const names = { films: () => 'films' }; const invoke = (parts, value) => value(); export const route = kind => invoke`/${names[kind]}/list`;",
    },
    certificate: false,
  },
  {
    name: "native class list can remove an unrelated literal token",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    container.querySelector",
        after: "    container.classList.remove('active');\n    container.querySelector",
      },
    ]),
    files: {},
    certificate: true,
  },
  {
    name: "class list removal of the selected carrier token remains unsupported",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    container.querySelector",
        after: "    container.classList.remove('carrier');\n    container.querySelector",
      },
    ]),
    files: {},
    certificate: false,
  },
  {
    name: "native container removal remains unsupported",
    source: withFixtureChanges(NATIVE_SOURCE, [
      {
        before: "    container.querySelector",
        after: "    container.remove();\n    container.querySelector",
      },
    ]),
    files: {},
    certificate: false,
  },
];
let temporaryDirectory = "";
const writeFixture = (relativePath: string, source: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};
const materialize = (entry: DeferredIframeCase): string => {
  writeFixture(
    "package.json",
    '{"private":true,"dependencies":{"react":"19.0.0","react-dom":"19.0.0","prop-types":"15.8.1"}}',
  );
  for (const [filename, source] of Object.entries(entry.files)) writeFixture(filename, source);
  return writeFixture("src/preview.tsx", entry.source);
};
const inspect = (entry: DeferredIframeCase, rule: Rule = certificateProbe) => {
  const filename = materialize(entry);
  return runRule(rule, entry.source, {
    filename,
    settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
  });
};
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-deferred-frame-"));
  resetFilesystemCaches();
});
afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  resetFilesystemCaches();
});
describe("finite possible deferred iframe source", () => {
  it.each(cases)("$name", (entry) => {
    const result = inspect(entry);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(entry.certificate ? 1 : 0);
  });
  it("reports the whole rule only for the new closed positive route", () => {
    const entry = cases[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing positive input");
    const result = inspect(entry, iframeMissingSandbox);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("retains the legacy ref bailout for an unused writer", () => {
    const entry = cases.find(
      (candidate) => candidate.name === "unused writer has no executable invoker",
    );
    if (!entry) throw new Error("Missing unused-writer input");
    const result = inspect(entry, iframeMissingSandbox);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("observes provider content edits with restored size and mtime", () => {
    const entry = cases.find(
      (candidate) =>
        candidate.name === "two conditional callback forwarding hops and static metadata",
    );
    if (!entry) throw new Error("Missing forwarding input");
    materialize(entry);
    const provider = path.join(temporaryDirectory, "src/frame.tsx");
    const initial = fs.readFileSync(provider, "utf8");
    const before = fs.statSync(provider);
    const first = computeSourceProjectFingerprint(temporaryDirectory);
    expect(first).not.toBeNull();
    expect(inspect(entry).diagnostics).toHaveLength(1);
    const changed = initial.replace('className="carrier"', 'className="changed"');
    expect(changed.length).toBe(initial.length);
    fs.writeFileSync(provider, changed);
    fs.utimesSync(provider, before.atime, before.mtime);
    resetFilesystemCaches();
    expect(computeSourceProjectFingerprint(temporaryDirectory)).not.toBe(first);
    const filename = path.join(temporaryDirectory, "src/preview.tsx");
    expect(
      runRule(certificateProbe, entry.source, {
        filename,
        settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
      }).diagnostics,
    ).toEqual([]);
  });
  it("includes ignored source and HTML appearance and deletion in the whole fingerprint", () => {
    const entry = cases[0];
    if (!entry) throw new Error("Missing positive input");
    materialize(entry);
    writeFixture(".gitignore", "hidden/\n");
    const initial = computeSourceProjectFingerprint(temporaryDirectory);
    expect(initial).not.toBeNull();
    for (const [filename, source] of [
      ["hidden/rival.tsx", "export const Rival = () => <iframe/>;"],
      ["hidden/entry.html", "<iframe></iframe>"],
    ]) {
      const target = writeFixture(filename, source);
      expect(computeSourceProjectFingerprint(temporaryDirectory)).not.toBe(initial);
      fs.unlinkSync(target);
      expect(computeSourceProjectFingerprint(temporaryDirectory)).toBe(initial);
    }
  });
  it.each(["react", "react/jsx-runtime", "react/jsx-dev-runtime"])(
    "records %s remap target appearance and deletion",
    (moduleSource) => {
      const entry = cases[0];
      if (!entry) throw new Error("Missing positive input");
      materialize(entry);
      writeFixture(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { [moduleSource]: ["./runtime/provider"] },
          },
        }),
      );
      const initial = computeSourceProjectFingerprint(temporaryDirectory);
      expect(initial).not.toBeNull();
      const filename = path.join(temporaryDirectory, "src/preview.tsx");
      const evaluate = () =>
        runRule(certificateProbe, entry.source, {
          filename,
          settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
        });
      expect(evaluate().diagnostics).toHaveLength(1);
      const target = writeFixture("runtime/provider.ts", "export const replacement = true;");
      resetFilesystemCaches();
      expect(computeSourceProjectFingerprint(temporaryDirectory)).not.toBe(initial);
      expect(evaluate().diagnostics).toEqual([]);
      fs.unlinkSync(target);
      resetFilesystemCaches();
      expect(computeSourceProjectFingerprint(temporaryDirectory)).toBe(initial);
      expect(evaluate().diagnostics).toHaveLength(1);
    },
  );
  it("records external parent JSX configuration despite explicit empty paths", () => {
    const entry = cases[0];
    if (!entry) throw new Error("Missing positive input");
    const project = path.join(temporaryDirectory, "project");
    fs.mkdirSync(project);
    const parent = writeFixture("shared.json", '{"compilerOptions":{"jsxImportSource":"react"}}');
    const parentStat = fs.statSync(parent);
    const outer = temporaryDirectory;
    temporaryDirectory = project;
    materialize(entry);
    writeFixture("tsconfig.json", '{"extends":"../shared.json","compilerOptions":{"paths":{}}}');
    const initial = computeSourceProjectFingerprint(project);
    expect(initial).not.toBeNull();
    fs.writeFileSync(parent, '{"compilerOptions":{"jsxImportSource":"other"}}');
    fs.utimesSync(parent, parentStat.atime, parentStat.mtime);
    resetFilesystemCaches();
    expect(computeSourceProjectFingerprint(project)).not.toBe(initial);
    temporaryDirectory = outer;
  });
  it.each([
    '{"compilerOptions":{"jsxImportSource":"other"}}',
    '{"compilerOptions":{"jsxFactory":"customCreate"}}',
    '{"compilerOptions":{"jsxFragmentFactory":"CustomFragment"}}',
    '{"extends":"./missing-parent.json"}',
    '{"compilerOptions":',
  ])("declines custom or incomplete JSX configuration %s", (configuration) => {
    const entry = cases[0];
    if (!entry) throw new Error("Missing positive input");
    const filename = materialize(entry);
    writeFixture("tsconfig.json", configuration);
    resetFilesystemCaches();
    const result = runRule(certificateProbe, entry.source, {
      filename,
      settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
