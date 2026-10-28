import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { regionHasAccessibleName } from "./region-has-accessible-name.js";

describe("region-has-accessible-name", () => {
  it.each([
    '<div role="region" />',
    '<section role="region" />',
    '<article role="region" />',
    '<aside role="region" />',
    '<main role="region" />',
    '<nav role="region" />',
    '<header role="region" />',
    '<footer role="region" />',
    '<div role={"region"} />',
    '<section role="region"><h2>Overview</h2><p>Content</p></section>',
    '<div><section role="region" /></div>',
    '<><section role="region" /></>',
    '<div role="region" style={{display: expanded ? "block" : "none"}} />',
    'const View = () => <>{active && <section role="region" />}</>;',
    'const View = () => <>{true && <section role="region" />}</>;',
    'const View = () => <>{false || <section role="region" />}</>;',
  ])("reports unnamed explicit containers (%s)", (code) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    "<section />",
    '<div role="group" />',
    "<div role={role} />",
    '<div role="region main" />',
    '<div role="REGION" />',
    '<div role="region" aria-label="Overview" />',
    '<div role="region" aria-labelledby="overview-title" />',
    '<div role="region" title="Overview" />',
    '<div role="region" aria-label={label} />',
    '<div role="region" aria-label="" />',
    '<div role="region" aria-labelledby={undefined} />',
    '<div role="region" title={null} />',
    '<div role="region" {...props} />',
    '<div {...props} role="region" />',
    '<div role="region" is="custom-region" />',
    '<div role="region" hidden />',
    '<div role="region" hidden="" />',
    '<div role="region" hidden={false} />',
    '<div role="region" aria-hidden="true" />',
    '<div role="region" aria-hidden={false} />',
    '<div role="region" inert />',
    '<div hidden><div role="region" /></div>',
    '<div aria-hidden="false"><div role="region" /></div>',
    '<div inert><div role="region" /></div>',
    '<div {...props}><div role="region" /></div>',
    '<div role="button"><div role="region" /></div>',
    '<button><div role="region" /></button>',
    '<div role="region" style={{display:"none"}} />',
    '<div style={{visibility:"hidden"}}><div role="region" /></div>',
    '<Region role="region" />',
    '<UI.Region role="region" />',
    '<Unknown><div role="region" /></Unknown>',
    '<Motion.div><div role="region" /></Motion.div>',
    '<svg><div role="region" /></svg>',
    '<math><div role="region" /></math>',
    '<template><div role="region" /></template>',
    '<noscript><div role="region" /></noscript>',
    '<script><div role="region" /></script>',
    '<style><div role="region" /></style>',
    '<textarea><div role="region" /></textarea>',
    '<title><div role="region" /></title>',
    '<iframe><div role="region" /></iframe>',
    '<object><div role="region" /></object>',
    '<embed><div role="region" /></embed>',
    '<div data-render={<div role="region" />} />',
    '<div children={<div role="region" />} />',
    '<div data-slot={{content:<div role="region" />}} />',
    'const View = () => <>{false && <section role="region" />}</>;',
    'const View = () => <>{true || <section role="region" />}</>;',
    'const View = () => true ? null : <section role="region" />;',
    'const View = () => false ? <section role="region" /> : null;',
    'const View = () => { if (false) return <section role="region" />; return null; };',
    'const View = () => { return null; return <section role="region" />; };',
  ])("leaves named or unsupported contexts quiet (%s)", (code) => {
    const result = runRule(regionHasAccessibleName, code);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});
