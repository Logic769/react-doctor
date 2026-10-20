import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
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

export const hasUnsupportedKeyedDraftRuntime = (program: EsTreeNode): boolean => {
  const unsupportedRuntimeNames = new Set(UNSUPPORTED_RUNTIME_NAMES);
  someAst(program, (node) => {
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      node.source.value !== "react"
    )
      return false;
    for (const specifier of node.specifiers) {
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        (specifier.importKind !== "type" && getStaticKeyName(specifier.imported) === "default")
      ) {
        unsupportedRuntimeNames.add(specifier.local.name);
      }
    }
    return false;
  });
  return someAst(program, (node) => {
    if (
      !isTypeScriptTypePosition(node) &&
      ((isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "constructor") ||
        (isNodeOfType(node, "Property") && getStaticKeyName(node.key) === "constructor"))
    )
      return true;
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
      !unsupportedRuntimeNames.has(node.name) ||
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
};
