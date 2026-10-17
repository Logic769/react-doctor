import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

export const containsImportedValueCall = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let foundImportedCall = false;
  walkAst(expression, (node) => {
    if (foundImportedCall) return false;
    if (!isNodeOfType(node, "CallExpression") || node.optional) return;
    let callee = stripParenExpression(node.callee);
    const visitedSymbolIds = new Set<number>();
    while (isNodeOfType(callee, "Identifier")) {
      const reference = scopes.referenceFor(callee);
      const symbol = reference?.resolvedSymbol;
      if (
        !symbol ||
        reference?.flag !== "read" ||
        visitedSymbolIds.has(symbol.id) ||
        symbol.references.some((candidateReference) => candidateReference.flag !== "read")
      ) {
        return;
      }
      if (getValueImportDeclaration(symbol)) {
        foundImportedCall = !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier");
        return;
      }
      const initializer = getDirectConstInitializer(symbol);
      if (!initializer || symbol.declarationNode.range[1] > callee.range[0]) return;
      visitedSymbolIds.add(symbol.id);
      callee = stripParenExpression(initializer);
    }
  });
  return foundImportedCall;
};
