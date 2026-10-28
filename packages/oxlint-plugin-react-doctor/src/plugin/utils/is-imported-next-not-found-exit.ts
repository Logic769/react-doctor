import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findGuardingTryStatement } from "./find-guarding-try-statement.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isValueImportFromModule } from "./is-value-import-from-module.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ImportedNextNotFoundExitInput {
  statement: EsTreeNode;
  scopes: ScopeAnalysis;
}

const nextNotFoundExitProofs = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

export const isImportedNextNotFoundExit = ({
  statement,
  scopes,
}: ImportedNextNotFoundExitInput): boolean => {
  let scopeProofs = nextNotFoundExitProofs.get(scopes);
  if (!scopeProofs) {
    scopeProofs = new WeakMap<EsTreeNode, boolean>();
    nextNotFoundExitProofs.set(scopes, scopeProofs);
  }
  const cachedProof = scopeProofs.get(statement);
  if (cachedProof !== undefined) return cachedProof;
  scopeProofs.set(statement, false);
  const lastStatement = isNodeOfType(statement, "BlockStatement")
    ? statement.body.at(-1)
    : statement;
  if (!lastStatement || !isNodeOfType(lastStatement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(lastStatement.expression);
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  const hasProvenExit = Boolean(
    symbol?.kind === "import" &&
    isValueImportFromModule(symbol, "next/navigation") &&
    getImportedName(symbol.declarationNode) === "notFound" &&
    symbol.references.every((reference) => reference.flag === "read") &&
    !findGuardingTryStatement(expression),
  );
  scopeProofs.set(statement, hasProvenExit);
  return hasProvenExit;
};
