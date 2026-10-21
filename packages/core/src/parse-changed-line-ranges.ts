import type { ChangedFileLineRanges } from "./types/index.js";

const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

interface MutableChangedFileLineRanges {
  file: string;
  ranges: Array<readonly [number, number]>;
  deletionLines: number[];
}

export const parseChangedLineRanges = (
  patch: string,
  includeDeletions = false,
): ChangedFileLineRanges[] => {
  const changesByFile = new Map<string, MutableChangedFileLineRanges>();
  let currentChanges: MutableChangedFileLineRanges | null = null;

  for (const line of patch.split("\n")) {
    if (includeDeletions && line.startsWith("rename to ")) {
      const file = line.slice("rename to ".length);
      changesByFile.set(file, { file, ranges: [], deletionLines: [] });
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        currentChanges = null;
        continue;
      }
      const file = target.startsWith("b/") ? target.slice(2) : target;
      currentChanges = changesByFile.get(file) ?? { file, ranges: [], deletionLines: [] };
      changesByFile.set(file, currentChanges);
      continue;
    }
    if (currentChanges === null) continue;
    const hunk = HUNK_HEADER_PATTERN.exec(line);
    if (hunk === null) continue;
    const start = Number(hunk[1]);
    const lineCount = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (lineCount === 0) {
      if (includeDeletions) currentChanges.deletionLines.push(start);
    } else {
      currentChanges.ranges.push([start, start + lineCount - 1]);
    }
  }

  return [...changesByFile.values()]
    .filter((entry) => entry.ranges.length > 0 || includeDeletions)
    .map(({ file, ranges, deletionLines }) => ({
      file,
      ranges,
      ...(deletionLines.length > 0 ? { deletionLines } : {}),
    }));
};
