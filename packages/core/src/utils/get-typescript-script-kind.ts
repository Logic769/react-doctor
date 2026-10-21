import ts from "typescript";

export const getTypescriptScriptKind = (fileName: string): ts.ScriptKind => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};
