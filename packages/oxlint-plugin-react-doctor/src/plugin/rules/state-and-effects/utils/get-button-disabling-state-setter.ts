import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import {
  DISABLING_STATE_SETTER_NAME_PATTERN,
  DISABLING_STATE_TUPLE_SLOT_COUNT,
} from "./constants.js";

interface ButtonDisablingStateSetterInput {
  eventAttribute: EsTreeNodeOfType<"JSXAttribute">;
  handlerFunction: EsTreeNodeOfType<"ArrowFunctionExpression">;
  lastMutatingAwaitEnd: number;
  firstAwaitStart: number;
  context: RuleContext;
}

export const getButtonDisablingStateSetter = ({
  eventAttribute,
  handlerFunction,
  lastMutatingAwaitEnd,
  firstAwaitStart,
  context,
}: ButtonDisablingStateSetterInput): SymbolDescriptor | null => {
  const openingElement = eventAttribute.parent;
  if (
    !isNodeOfType(eventAttribute.name, "JSXIdentifier") ||
    eventAttribute.name.name !== "onClick" ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    openingElement.name.name !== "button" ||
    getAuthoritativeJsxAttribute(openingElement.attributes, "onClick") !== eventAttribute ||
    lastMutatingAwaitEnd < 0 ||
    firstAwaitStart < 0
  )
    return null;
  const disabledAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "disabled");
  if (!isNodeOfType(disabledAttribute?.value, "JSXExpressionContainer")) return null;
  const stateReference = stripParenExpression(disabledAttribute.value.expression);
  if (!isNodeOfType(stateReference, "Identifier")) return null;
  const componentFunction = findEnclosingFunction(eventAttribute);
  if (!isFunctionLike(componentFunction) || !isNodeOfType(componentFunction.body, "BlockStatement"))
    return null;
  let hasUnsupportedOwnerSyntax = false;
  walkAst(componentFunction.body, (node) => {
    if (
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "eval" &&
        context.scopes.isGlobalReference(node))
    )
      hasUnsupportedOwnerSyntax = true;
  });
  if (hasUnsupportedOwnerSyntax) return null;
  const stateSymbol = context.scopes.symbolFor(stateReference);
  if (!stateSymbol || stateSymbol.kind !== "const") return null;
  const binding = collectUseStateBindings(componentFunction.body, context.scopes).find(
    (candidate) => candidate.declarator === stateSymbol.declarationNode,
  );
  if (!binding || !isNodeOfType(binding.declarator.id, "ArrayPattern")) return null;
  const [stateIdentifier, setterIdentifier] = binding.declarator.id.elements;
  const hookCall = binding.declarator.init;
  if (
    binding.declarator.id.elements.length !== DISABLING_STATE_TUPLE_SLOT_COUNT ||
    stateIdentifier !== stateSymbol.bindingIdentifier ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    !DISABLING_STATE_SETTER_NAME_PATTERN.test(setterIdentifier.name) ||
    !isNodeOfType(hookCall, "CallExpression") ||
    hookCall.optional ||
    !isNodeOfType(hookCall.callee, "Identifier") ||
    hookCall.arguments.length !== 1 ||
    !isNodeOfType(hookCall.arguments[0], "Literal") ||
    hookCall.arguments[0].value !== false ||
    stateSymbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return null;
  const hookSymbol = context.scopes.symbolFor(hookCall.callee);
  if (
    !hookSymbol ||
    getValueImportSource(hookSymbol) !== "react" ||
    getImportedName(hookSymbol.declarationNode) !== "useState"
  )
    return null;
  for (const symbol of context.scopes.rootScope.symbols) {
    const importDeclaration = symbol.declarationNode.parent;
    if (
      !isNodeOfType(importDeclaration, "ImportDeclaration") ||
      importDeclaration.source.value !== "react"
    )
      continue;
    if (getValueImportSource(symbol) !== "react") {
      if (symbol.references.length > 0) return null;
      continue;
    }
    if (
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      getImportedName(symbol.declarationNode) === "default"
    )
      return null;
    for (const reference of symbol.references) {
      const identifier = findTransparentExpressionRoot(reference.identifier);
      const call = identifier.parent;
      if (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(reference.identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== identifier ||
        call.optional
      )
        return null;
    }
  }
  if (!isNodeOfType(eventAttribute.value, "JSXExpressionContainer")) return null;
  const handlerReference = stripParenExpression(eventAttribute.value.expression);
  if (handlerReference !== handlerFunction) {
    if (!isNodeOfType(handlerReference, "Identifier")) return null;
    const handlerSymbol = context.scopes.symbolFor(handlerReference);
    if (!handlerSymbol) return null;
    const initializer = getDirectConstInitializer(handlerSymbol);
    if (
      !initializer ||
      stripParenExpression(initializer) !== handlerFunction ||
      findEnclosingFunction(handlerSymbol.declarationNode) !== componentFunction ||
      handlerSymbol.references.length !== 1 ||
      handlerSymbol.references[0]?.identifier !== handlerReference ||
      handlerSymbol.references[0]?.flag !== "read" ||
      isWithinAssignmentTarget(handlerReference)
    )
      return null;
  }
  let hasUnsupportedLoop = false;
  walkAst(handlerFunction.body, (node) => {
    if (isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ForStatement") ||
      isNodeOfType(node, "ForOfStatement") ||
      isNodeOfType(node, "ForInStatement") ||
      isNodeOfType(node, "WhileStatement") ||
      isNodeOfType(node, "DoWhileStatement")
    )
      hasUnsupportedLoop = true;
  });
  if (hasUnsupportedLoop) return null;
  const setterSymbol = context.scopes.symbolFor(setterIdentifier);
  if (!setterSymbol || setterSymbol.kind !== "const") return null;
  for (const reference of setterSymbol.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(reference.identifier) ||
      findEnclosingFunction(reference.identifier) !== handlerFunction ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== identifier ||
      call.optional ||
      call.arguments.length !== 1 ||
      !isNodeOfType(call.arguments[0], "Literal") ||
      typeof call.arguments[0].value !== "boolean" ||
      !isNodeOfType(findTransparentExpressionRoot(call).parent, "ExpressionStatement")
    )
      return null;
    const startIndex = getNodeStartIndex(call);
    const callStart = startIndex >= 0 ? startIndex : call.range?.[0];
    if (
      callStart === undefined ||
      callStart < 0 ||
      (call.arguments[0].value === true
        ? callStart >= firstAwaitStart
        : callStart <= lastMutatingAwaitEnd)
    )
      return null;
  }
  return setterSymbol;
};
