import type { ScannedFile } from "../../../utils/file-scan.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const collectJsxHtmlAttributeEnds = (file: ScannedFile): Map<number, number> => {
  const attributeEnds = new Map<number, number>();
  const program = parseSourceText({
    filename: file.absolutePath,
    sourceText: file.content,
    shouldAttachParentReferences: false,
  });
  if (program === null) return attributeEnds;
  walkAst(program, (node) => {
    if (
      node.type !== "JSXAttribute" ||
      node.name.type !== "JSXIdentifier" ||
      node.name.name !== "dangerouslySetInnerHTML"
    ) {
      return;
    }
    const startIndex = getNodeStartIndex(node);
    const endIndex = getNodeEndIndex(node);
    if (startIndex >= 0 && endIndex > startIndex) attributeEnds.set(startIndex, endIndex);
  });
  return attributeEnds;
};
