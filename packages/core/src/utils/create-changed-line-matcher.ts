import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { getRuleMetadata } from "../rule-metadata.js";
import type { ChangedFileLineRanges, Diagnostic } from "../types/index.js";
import { doesContextIntersectChanges } from "./does-context-intersect-changes.js";
import { diagnosticIntersectsLineRanges } from "./diagnostic-intersects-line-ranges.js";
import { getTypescriptScriptKind } from "./get-typescript-script-kind.js";
import { utf8OffsetFromSourcePosition } from "./utf8-offset-from-source-position.js";

interface ChangedLineMatcherInput {
  readonly directory: string;
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges>;
  readonly contextual?: boolean;
}

export const createChangedLineMatcher = ({
  directory,
  changedLineRanges,
  contextual = false,
}: ChangedLineMatcherInput): ((diagnostic: Diagnostic) => boolean) => {
  const changesByFile = new Map(
    changedLineRanges.map((entry) => [
      path.resolve(directory, entry.file.replaceAll("\\", "/")),
      entry,
    ]),
  );
  const sourceFiles = new Map<string, ts.SourceFile | null>();

  return (diagnostic) => {
    const filePath = path.resolve(directory, diagnostic.filePath.replaceAll("\\", "/"));
    const changes = changesByFile.get(filePath);
    if (!changes) return false;
    if (diagnosticIntersectsLineRanges(diagnostic, changes.ranges)) return true;
    if (!contextual) return false;
    const scope = getRuleMetadata(diagnostic.plugin, diagnostic.rule)?.diffScope ?? "line";
    if (scope === "file") return true;
    if (scope === "line" || !/\.[cm]?[jt]sx?$/i.test(filePath)) return false;

    if (!sourceFiles.has(filePath)) {
      try {
        const sourceFile = ts.createSourceFile(
          filePath,
          fs.readFileSync(filePath, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          getTypescriptScriptKind(filePath),
        );
        const hasParseErrors =
          "parseDiagnostics" in sourceFile &&
          Array.isArray(sourceFile.parseDiagnostics) &&
          sourceFile.parseDiagnostics.length > 0;
        sourceFiles.set(filePath, hasParseErrors ? null : sourceFile);
      } catch {
        sourceFiles.set(filePath, null);
      }
    }
    const sourceFile = sourceFiles.get(filePath);
    if (!sourceFile) return false;
    const sourceBuffer = Buffer.from(sourceFile.text);
    const byteOffset =
      diagnostic.offset ??
      utf8OffsetFromSourcePosition(sourceBuffer, diagnostic.line, diagnostic.column - 1);
    if (byteOffset === null || byteOffset < 0 || byteOffset >= sourceBuffer.length) return false;
    const position = sourceBuffer.subarray(0, byteOffset).toString("utf8").length;
    const isBoundary = (node: ts.Node): boolean =>
      scope === "function"
        ? ts.isFunctionLike(node)
        : ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
    let owner: ts.Node | null = null;
    const findOwner = (node: ts.Node): void => {
      if (position < node.getStart(sourceFile) || position >= node.getEnd()) return;
      if (isBoundary(node)) owner = node;
      ts.forEachChild(node, findOwner);
    };
    findOwner(sourceFile);
    if (!owner) return false;
    return doesContextIntersectChanges({ sourceFile, owner, changes, isBoundary });
  };
};
