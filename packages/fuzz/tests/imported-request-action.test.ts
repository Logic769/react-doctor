import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noAsyncEventHandlerWithoutReentryGuard } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-async-event-handler-without-reentry-guard.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

it("replays the complete imported request and action regression", () => {
  const sourcePath = fileURLToPath(
    new URL("../fixtures/imported-request-action/screen.tsx", import.meta.url),
  );
  const result = fuzzRuleWithStats(
    noAsyncEventHandlerWithoutReentryGuard.id,
    noAsyncEventHandlerWithoutReentryGuard,
    {
      iterations: 0,
      corpus: [
        {
          relativePath: "true-positives/imported-request-action.tsx",
          sourcePath,
          code: fs.readFileSync(sourcePath, "utf8"),
          ruleIds: [noAsyncEventHandlerWithoutReentryGuard.id],
          verdict: "fail",
        },
      ],
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  expect(result.stats.skippedParseErrorCount).toBe(0);
});
