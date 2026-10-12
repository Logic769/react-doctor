import ts from "typescript";
import type { ChangedFileLineRanges } from "../types/index.js";

interface ContextIntersectionInput {
  readonly sourceFile: ts.SourceFile;
  readonly owner: ts.Node;
  readonly changes: ChangedFileLineRanges;
  readonly isBoundary: (node: ts.Node) => boolean;
}

export const doesContextIntersectChanges = ({
  sourceFile,
  owner,
  changes,
  isBoundary,
}: ContextIntersectionInput): boolean => {
  const startLine = sourceFile.getLineAndCharacterOfPosition(owner.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(owner.getEnd() - 1).line + 1;
  const childRanges: Array<readonly [number, number]> = [];
  const collectChildren = (node: ts.Node): void => {
    if (isBoundary(node)) {
      childRanges.push([
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        sourceFile.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1,
      ]);
      return;
    }
    ts.forEachChild(node, collectChildren);
  };
  ts.forEachChild(owner, collectChildren);

  for (const [changedStart, changedEnd] of changes.ranges) {
    let remainingStart = Math.max(startLine, changedStart);
    const remainingEnd = Math.min(endLine, changedEnd);
    for (const [childStart, childEnd] of childRanges) {
      if (childEnd < remainingStart) continue;
      if (childStart > remainingEnd) break;
      if (childStart > remainingStart) return true;
      remainingStart = Math.max(remainingStart, childEnd + 1);
    }
    if (remainingStart <= remainingEnd) return true;
  }
  return (changes.deletionLines ?? []).some(
    (deletionLine) =>
      deletionLine >= startLine &&
      deletionLine < endLine &&
      !childRanges.some(
        ([childStart, childEnd]) => deletionLine >= childStart && deletionLine < childEnd,
      ),
  );
};
