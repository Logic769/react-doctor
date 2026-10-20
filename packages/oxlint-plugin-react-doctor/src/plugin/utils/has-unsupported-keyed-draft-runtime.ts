import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { someAst } from "./some-ast.js";

const UNSUPPORTED_RUNTIME_NAMES: ReadonlySet<string> = new Set([
  "eval",
  "Function",
  "Reflect",
  "globalThis",
  "global",
  "window",
  "self",
  "React",
  "require",
]);

export const hasUnsupportedKeyedDraftRuntime = (program: EsTreeNode): boolean =>
  someAst(program, (node) => {
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "TSImportEqualsDeclaration"))
      return true;
    if (isNodeOfType(node, "ImportDeclaration")) {
      return (
        node.importKind !== "type" &&
        (node.source.value === "react/jsx-runtime" || node.source.value === "react/jsx-dev-runtime")
      );
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !UNSUPPORTED_RUNTIME_NAMES.has(node.name) ||
      isTypeScriptTypePosition(node)
    )
      return false;
    const parent = node.parent;
    return !(
      (isNodeOfType(parent, "ImportSpecifier") ||
        isNodeOfType(parent, "ImportNamespaceSpecifier") ||
        isNodeOfType(parent, "ImportDefaultSpecifier")) &&
      parent.local === node
    );
  });
