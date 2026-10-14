import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "./find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getTransparentReactCallbackWrapperArgument } from "./get-transparent-react-callback-wrapper-argument.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isReactApiCall } from "./is-react-api-call.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const CALLBACK_REACHABILITY_OPTIONS = { evaluatePrimitiveLiteralTruthiness: true };

export const findRenderInvokedUseCallbackOwner = (
  node: EsTreeNode,
  context: RuleContext,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): EsTreeNode | null => {
  if (!isNodeReachableWithinFunction(node, context, CALLBACK_REACHABILITY_OPTIONS)) return null;
  const callbackFunction = findEnclosingFunction(node);
  if (
    !callbackFunction ||
    !isFunctionLike(callbackFunction) ||
    callbackFunction.async ||
    callbackFunction.generator ||
    callbackFunction.params.length !== 0 ||
    visitedFunctions.has(callbackFunction)
  ) {
    return null;
  }
  const wrapperCall = findTransparentExpressionRoot(callbackFunction).parent;
  if (
    !isNodeOfType(wrapperCall, "CallExpression") ||
    !isReactApiCall(wrapperCall, "useCallback", context.scopes)
  ) {
    return null;
  }
  const declarator = findTransparentExpressionRoot(wrapperCall).parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const"
  ) {
    return null;
  }
  const callbackSymbol = context.scopes.symbolFor(declarator.id);
  const callbackArgument = getTransparentReactCallbackWrapperArgument(
    wrapperCall,
    callbackSymbol,
    context.scopes,
  );
  const hookCallee = stripParenExpression(wrapperCall.callee);
  const hookIdentifier = getRootIdentifier(hookCallee);
  const hookSymbol = hookIdentifier ? context.scopes.symbolFor(hookIdentifier) : null;
  if (
    !callbackSymbol ||
    !hookIdentifier ||
    !hookSymbol ||
    [...callbackSymbol.references, ...hookSymbol.references].some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    (isNodeOfType(hookCallee, "MemberExpression") &&
      hasPossibleStaticPropertyMutationOrEscape(hookIdentifier, "useCallback", context.scopes)) ||
    !callbackArgument ||
    stripParenExpression(callbackArgument) !== callbackFunction
  ) {
    return null;
  }
  const nextVisitedFunctions = new Set(visitedFunctions).add(callbackFunction);
  for (const reference of callbackSymbol.references) {
    const callee = findTransparentExpressionRoot(reference.identifier);
    const call = callee.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== callee ||
      declarator.range[1] > call.range[0] ||
      !isNodeReachableWithinFunction(call, context, CALLBACK_REACHABILITY_OPTIONS)
    ) {
      continue;
    }
    const renderOwner =
      findRenderPhaseComponentOrHook(call, context.scopes) ??
      findRenderInvokedUseCallbackOwner(call, context, nextVisitedFunctions);
    if (renderOwner) return renderOwner;
  }
  return null;
};
