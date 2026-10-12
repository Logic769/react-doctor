import { describe, expect, it } from "vite-plus/test";
import type { DiffInfo, ScopeValue } from "@react-doctor/core";
import type { TuiScanScopePlan } from "../src/cli/utils/resolve-tui-scan-scope.js";
import { resolveProjectTuiScanScope } from "../src/cli/utils/resolve-project-tui-scan-scope.js";

const buildDiffInfo = (changedFiles: string[]): DiffInfo => ({
  currentBranch: "feature",
  baseBranch: "main",
  changedFiles,
  isCurrentChanges: true,
});

const buildPlan = (
  scope: ScopeValue,
  changedFiles: string[] = ["apps/web/src/app.tsx"],
): TuiScanScopePlan => ({
  baselineDiffPlan: null,
  baselineRef: null,
  changedLineRanges: null,
  diffInfo: scope === "full" ? null : buildDiffInfo(changedFiles),
  scope,
});

describe("resolveProjectTuiScanScope", () => {
  it("returns no restrictions for full scans", () => {
    expect(
      resolveProjectTuiScanScope({
        plan: buildPlan("full"),
        projectDirectory: "/repo/apps/web",
        rootDirectory: "/repo",
        supplyChainEnabled: true,
      }),
    ).toEqual({});
  });

  it.each<ScopeValue>(["lines", "contextual"])(
    "maps %s ranges into a workspace project",
    (scope) => {
      const plan = buildPlan(scope);
      const scopedPlan: TuiScanScopePlan = {
        ...plan,
        changedLineRanges: [{ file: "apps/web/src/app.tsx", ranges: [[3, 5]], deletionLines: [6] }],
      };

      expect(
        resolveProjectTuiScanScope({
          plan: scopedPlan,
          projectDirectory: "/repo/apps/web",
          rootDirectory: "/repo",
          supplyChainEnabled: true,
        }),
      ).toEqual({
        contextual: scope === "contextual",
        baseline: undefined,
        changedLineRanges: [{ file: "src/app.tsx", ranges: [[3, 5]], deletionLines: [6] }],
        includePaths: ["src/app.tsx"],
        supplyChainManifestChanged: false,
      });
    },
  );

  it("keeps a manifest-only project when supply-chain checks are enabled", () => {
    expect(
      resolveProjectTuiScanScope({
        plan: buildPlan("files", ["apps/web/package.json"]),
        projectDirectory: "/repo/apps/web",
        rootDirectory: "/repo",
        supplyChainEnabled: true,
      }),
    ).toEqual({
      contextual: false,
      baseline: undefined,
      changedLineRanges: undefined,
      includePaths: ["package.json"],
      supplyChainManifestChanged: true,
    });
  });

  it("keeps deleted baseline files in changed scope", () => {
    const plan: TuiScanScopePlan = {
      ...buildPlan("changed", []),
      baselineDiffPlan: {
        baseFiles: ["apps/web/src/deleted.tsx"],
        headFiles: [],
        untrackedFiles: [],
      },
      baselineRef: "base-commit",
    };

    expect(
      resolveProjectTuiScanScope({
        plan,
        projectDirectory: "/repo/apps/web",
        rootDirectory: "/repo",
        supplyChainEnabled: false,
      }),
    ).toEqual({
      contextual: false,
      baseline: {
        ref: "base-commit",
        baseFiles: ["src/deleted.tsx"],
        headFiles: [],
      },
      changedLineRanges: undefined,
      includePaths: ["src/deleted.tsx"],
      supplyChainManifestChanged: false,
    });
  });

  it("skips projects without relevant changes", () => {
    expect(
      resolveProjectTuiScanScope({
        plan: buildPlan("files", ["apps/admin/src/app.tsx"]),
        projectDirectory: "/repo/apps/web",
        rootDirectory: "/repo",
        supplyChainEnabled: true,
      }),
    ).toBeNull();
  });
});
