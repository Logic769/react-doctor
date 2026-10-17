import { PLAIN_STATE_ALIAS_UNSUPPORTED_NODE_TYPES } from "../../../constants/plain-state-alias.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export const isReadonlyNamedReactStateHook = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    declaration.source.value !== "react" ||
    isTypeOnlyImport(declaration) ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    getImportedName(symbol.declarationNode) !== "useState"
  )
    return false;
  let isClosed = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (PLAIN_STATE_ALIAS_UNSUPPORTED_NODE_TYPES.has(node.type)) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.referenceFor(node)) {
      const evalSymbol = scopes.symbolFor(node);
      if (
        scopes.isGlobalReference(node) ||
        evalSymbol?.kind === "ts-interface" ||
        evalSymbol?.kind === "ts-type-alias"
      ) {
        isClosed = false;
        return false;
      }
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.source.value !== "react" ||
      isTypeOnlyImport(node)
    )
      return;
    for (const specifier of node.specifiers) {
      const isNamedStateHook =
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        getImportedName(specifier) === "useState";
      const isNamespaceProvider =
        isNodeOfType(specifier, "ImportDefaultSpecifier") ||
        isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
        (isNodeOfType(specifier, "ImportSpecifier") &&
          specifier.importKind !== "type" &&
          getImportedName(specifier) === "default");
      if (!isNamedStateHook && !isNamespaceProvider) continue;
      const importedSymbol = scopes.symbolFor(specifier.local);
      if (!importedSymbol) {
        isClosed = false;
        return false;
      }
      for (const reference of importedSymbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const consumer = referenceRoot.parent;
        if (
          isNamespaceProvider ||
          reference.flag !== "read" ||
          !isNodeOfType(consumer, "CallExpression") ||
          consumer.optional ||
          consumer.callee !== referenceRoot
        ) {
          isClosed = false;
          return false;
        }
      }
    }
  });
  return isClosed;
};
