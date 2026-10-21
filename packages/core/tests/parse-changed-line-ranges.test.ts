import { describe, expect, it } from "vite-plus/test";
import { parseChangedLineRanges } from "../src/parse-changed-line-ranges.js";

describe("parseChangedLineRanges", () => {
  it("parses new-side hunk ranges per file", () => {
    const patch = [
      "diff --git a/src/App.tsx b/src/App.tsx",
      "index 1111111..2222222 100644",
      "--- a/src/App.tsx",
      "+++ b/src/App.tsx",
      "@@ -10 +10,2 @@",
      "+const a = 1;",
      "+const b = 2;",
      "@@ -20,0 +23 @@",
      "+const c = 3;",
    ].join("\n");
    expect(parseChangedLineRanges(patch)).toEqual([
      {
        file: "src/App.tsx",
        ranges: [
          [10, 11],
          [23, 23],
        ],
      },
    ]);
  });

  it("keys multiple files independently", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "+x",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -5,0 +6,3 @@",
      "+y",
      "+z",
      "+w",
    ].join("\n");
    expect(parseChangedLineRanges(patch)).toEqual([
      { file: "a.ts", ranges: [[1, 1]] },
      { file: "b.ts", ranges: [[6, 8]] },
    ]);
  });

  it("skips pure-deletion hunks (zero new-side lines) and deleted files", () => {
    const patch = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
      "diff --git a/edited.ts b/edited.ts",
      "--- a/edited.ts",
      "+++ b/edited.ts",
      "@@ -4 +4,0 @@",
      "-removed only",
    ].join("\n");
    expect(parseChangedLineRanges(patch)).toEqual([]);
  });

  it("returns an empty array for an empty patch", () => {
    expect(parseChangedLineRanges("")).toEqual([]);
  });

  it("retains deletion gaps only when requested", () => {
    const patch = "+++ b/app.tsx\n@@ -1,2 +0,0 @@\n-removed\n@@ -8,2 +5,0 @@\n-removed";
    expect(parseChangedLineRanges(patch, true)).toEqual([
      { file: "app.tsx", ranges: [], deletionLines: [0, 5] },
    ]);
    expect(parseChangedLineRanges(patch)).toEqual([]);
  });

  it("retains pure renames for contextual file rules", () => {
    const patch =
      "diff --git a/old.tsx b/new.tsx\nsimilarity index 100%\nrename from old.tsx\nrename to new.tsx";
    expect(parseChangedLineRanges(patch, true)).toEqual([{ file: "new.tsx", ranges: [] }]);
    expect(parseChangedLineRanges(patch)).toEqual([]);
  });
});
