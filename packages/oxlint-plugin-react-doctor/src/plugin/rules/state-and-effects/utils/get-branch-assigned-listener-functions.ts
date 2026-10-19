import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { collectReturnedCleanupFunctions } from "../../../utils/collect-returned-cleanup-functions.js";
import { collectSynchronouslyInvokedLocalFunctions } from "../../../utils/collect-effect-invoked-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isEventHandlerAttribute } from "../../../utils/is-event-handler-attribute.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { nodesCanCoExecute } from "../../../utils/nodes-can-co-execute.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import { isProvenBrowserApiReceiver } from "../../../utils/is-proven-browser-api-receiver.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface BranchListenerAssignment {
  readonly assignment: EsTreeNodeOfType<"AssignmentExpression">;
  readonly callback: EsTreeNode;
}

interface BranchListenerPredicate {
  readonly consequent: boolean;
  readonly alternate: boolean;
}

const nativeConstructorNames = new Set([
  "Audio",
  "DocumentFragment",
  "EventTarget",
  "Image",
  "Option",
]);
const reflectiveMutationNames = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "set",
  "deleteProperty",
]);

const dynamicScopeByProgram = new WeakMap<EsTreeNode, boolean>();

const isProviderWriteTarget = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier"))
    return (
      nativeConstructorNames.has(node.name) ||
      node.name === "window" ||
      node.name === "document" ||
      node.name === "self" ||
      node.name === "globalThis"
    );
  if (!isNodeOfType(node, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(node);
  return (
    (node.computed && propertyName === null) ||
    nativeConstructorNames.has(propertyName ?? "") ||
    propertyName === "addEventListener" ||
    propertyName === "removeEventListener"
  );
};

const hasDynamicScope = (program: EsTreeNode): boolean => {
  const cached = dynamicScopeByProgram.get(program);
  if (cached !== undefined) return cached;
  const result = someAst(program, (node) => {
    const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
    return (
      node.type === "WithStatement" ||
      node.type === "TSParameterProperty" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      (isNodeOfType(callee, "Identifier") && callee.name === "eval") ||
      (isNodeOfType(node, "AssignmentExpression") && isProviderWriteTarget(node.left)) ||
      (isNodeOfType(node, "UpdateExpression") && isProviderWriteTarget(node.argument)) ||
      (isNodeOfType(node, "UnaryExpression") &&
        node.operator === "delete" &&
        isProviderWriteTarget(node.argument)) ||
      (isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.object, "Identifier") &&
        (node.callee.object.name === "Object" || node.callee.object.name === "Reflect") &&
        reflectiveMutationNames.has(getStaticPropertyName(node.callee) ?? ""))
    );
  });
  dynamicScopeByProgram.set(program, result);
  return result;
};

const getBranchAssignment = (
  branch: EsTreeNode,
  symbol: SymbolDescriptor,
  context: RuleContext,
): BranchListenerAssignment | null => {
  if (!isNodeOfType(branch, "BlockStatement")) return null;
  const [statement, ...remainingStatements] = branch.body;
  if (remainingStatements.length || !isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = statement.expression;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "Identifier") ||
    context.scopes.symbolFor(assignment.left)?.id !== symbol.id
  )
    return null;
  const callback = assignment.right;
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator
  )
    return null;
  return { assignment, callback };
};

const isDirectParameter = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "parameter") return false;
  let current: EsTreeNode | null | undefined = symbol.bindingIdentifier;
  while (current && current !== symbol.scope.node) {
    if (isNodeOfType(current, "AssignmentPattern")) return false;
    current = current.parent;
  }
  if (current !== symbol.scope.node) return false;
  const declaration = symbol.declarationNode;
  if (isNodeOfType(declaration, "Identifier")) return declaration === symbol.bindingIdentifier;
  if (!isNodeOfType(declaration, "ObjectPattern")) return false;
  return declaration.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      property.value === symbol.bindingIdentifier &&
      isNodeOfType(property.value, "Identifier"),
  );
};

const isEventOnlyFunction = (
  functionNode: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const isEventReference = (node: EsTreeNode): boolean => {
    const container = node.parent;
    if (
      !isNodeOfType(container, "JSXExpressionContainer") ||
      container.expression !== node ||
      !isEventHandlerAttribute(container.parent)
    )
      return false;
    const openingElement = container.parent.parent;
    let element = openingElement?.parent;
    if (!isNodeOfType(openingElement, "JSXOpeningElement") || !isNodeOfType(element, "JSXElement"))
      return false;
    while (
      isNodeOfType(element.parent, "JSXElement") ||
      isNodeOfType(element.parent, "JSXFragment")
    )
      element = element.parent;
    const returnStatement = element.parent;
    return (
      isNodeOfType(returnStatement, "ReturnStatement") &&
      returnStatement.argument === element &&
      context.cfg.enclosingFunction(returnStatement) === component
    );
  };
  if (isEventReference(functionNode)) return true;
  const declarator = functionNode.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== functionNode ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const symbol = context.scopes.symbolFor(declarator.id);
  return Boolean(
    symbol?.kind === "const" &&
    symbol.references.length &&
    symbol.references.every(
      (reference) => reference.flag === "read" && isEventReference(reference.identifier),
    ),
  );
};

const isNativeTargetValue = (value: EsTreeNode, context: RuleContext): boolean => {
  let initializer = value;
  if (isNodeOfType(initializer, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(initializer, context.scopes);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      symbol.references.some((reference) => reference.flag !== "read")
    )
      return false;
    initializer = symbol.initializer;
  }
  if (!isNodeOfType(initializer, "NewExpression")) return false;
  return (
    isProvenBrowserApiReceiver(initializer, "dom-event-target", context.scopes) ||
    (isNodeOfType(initializer.callee, "Identifier") &&
      initializer.callee.name === "Audio" &&
      context.scopes.isGlobalReference(initializer.callee))
  );
};

const hasNativeReceiverValue = (receiver: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(receiver, context.scopes, true);
  if (!symbol)
    return (
      (receiver.name === "window" ||
        receiver.name === "document" ||
        receiver.name === "self" ||
        receiver.name === "globalThis") &&
      context.scopes.isGlobalReference(receiver)
    );
  if (isDirectParameter(symbol)) {
    return symbol.references.every((reference) => reference.flag === "read");
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    symbol.references.some((reference) => reference.flag !== "read")
  )
    return false;
  if (isNativeTargetValue(receiver, context)) return true;
  const declarator = symbol.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression")
  )
    return false;
  const [state, setter] = declarator.id.elements;
  const [seed, ...additionalArguments] = declarator.init.arguments;
  if (
    state !== symbol.bindingIdentifier ||
    !isNodeOfType(setter, "Identifier") ||
    !seed ||
    isNodeOfType(seed, "SpreadElement") ||
    additionalArguments.length
  )
    return false;
  const pair = resolveReactUseStatePair(setter, context.scopes);
  const component = context.cfg.enclosingFunction(declarator);
  if (!pair || pair.stateSymbol?.id !== symbol.id || !component) return false;
  const renderFunctions = collectSynchronouslyInvokedLocalFunctions(component, context.scopes);
  let hasNativeValue = isNativeTargetValue(seed, context);
  if (!hasNativeValue && !(isNodeOfType(seed, "Literal") && seed.value === null)) return false;
  for (const reference of pair.setterSymbol.references) {
    const call = reference.identifier.parent;
    const owner = context.cfg.enclosingFunction(reference.identifier);
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      !owner ||
      renderFunctions.has(owner)
    )
      return false;
    const [value, ...additionalValues] = call.arguments;
    if (!value || isNodeOfType(value, "SpreadElement") || additionalValues.length) return false;
    if (isNativeTargetValue(value, context)) hasNativeValue = true;
    else if (!isNodeOfType(value, "Literal") || value.value !== null) return false;
  }
  return hasNativeValue;
};

const getPredicateBranches = (
  predicate: EsTreeNode,
  context: RuleContext,
): BranchListenerPredicate | null => {
  if (!isNodeOfType(predicate, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(predicate);
  if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
  if (isDirectParameter(symbol)) return { consequent: true, alternate: true };
  const declarator = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression")
  )
    return null;
  const [state, setter] = declarator.id.elements;
  const [seed, ...additionalArguments] = declarator.init.arguments;
  if (
    state !== symbol.bindingIdentifier ||
    !isNodeOfType(setter, "Identifier") ||
    additionalArguments.length ||
    !isNodeOfType(seed, "Literal") ||
    typeof seed.value !== "boolean"
  )
    return null;
  const pair = resolveReactUseStatePair(setter, context.scopes);
  const component = context.cfg.enclosingFunction(declarator);
  if (!pair || pair.stateSymbol?.id !== symbol.id || !component) return null;
  const renderFunctions = collectSynchronouslyInvokedLocalFunctions(component, context.scopes);
  if (
    pair.setterSymbol.references.some((reference) => {
      const call = reference.identifier.parent;
      const owner = context.cfg.enclosingFunction(reference.identifier);
      return (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== reference.identifier ||
        !owner ||
        renderFunctions.has(owner) ||
        !isEventOnlyFunction(owner, component, context)
      );
    })
  )
    return null;
  return { consequent: seed.value, alternate: !seed.value };
};

const isMatchingCleanupReference = (
  identifier: EsTreeNode,
  registration: EsTreeNodeOfType<"CallExpression">,
  cleanupFunctions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const call = identifier.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    !isNodeOfType(call.callee.property, "Identifier") ||
    call.callee.property.name !== "removeEventListener" ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    !isNodeOfType(registration.callee, "MemberExpression") ||
    !isNodeOfType(registration.callee.object, "Identifier")
  )
    return false;
  const [event, callback, ...otherArguments] = call.arguments;
  const [registeredEvent] = registration.arguments;
  const owner = context.cfg.enclosingFunction(call);
  return Boolean(
    !otherArguments.length &&
    callback === identifier &&
    isNodeOfType(event, "Literal") &&
    isNodeOfType(registeredEvent, "Literal") &&
    event.value === registeredEvent.value &&
    owner &&
    cleanupFunctions.has(owner) &&
    resolveExpressionKey(call.callee.object, context) !== null &&
    resolveExpressionKey(call.callee.object, context) ===
      resolveExpressionKey(registration.callee.object, context),
  );
};

export const getBranchAssignedListenerFunctions = (
  registration: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): EsTreeNode[] => {
  const [event, listener, ...otherArguments] = registration.arguments;
  const callee = registration.callee;
  if (
    registration.optional ||
    otherArguments.length ||
    !isNodeOfType(event, "Literal") ||
    typeof event.value !== "string" ||
    !isNodeOfType(listener, "Identifier") ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "addEventListener" ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return [];
  if (!hasNativeReceiverValue(callee.object, context)) return [];
  const program = findProgramRoot(registration);
  if (!program || hasDynamicScope(program)) return [];
  const effect = context.cfg.enclosingFunction(registration);
  const effectCall = effect?.parent;
  if (
    !effect ||
    !isFunctionLike(effect) ||
    !isNodeOfType(effectCall, "CallExpression") ||
    effectCall.arguments[0] !== effect ||
    !isReactApiCall(effectCall, "useEffect", context.scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  )
    return [];
  let ancestor: EsTreeNode | null | undefined = registration.parent;
  while (ancestor && ancestor !== effect) {
    if (
      ancestor.type === "ForStatement" ||
      ancestor.type === "ForInStatement" ||
      ancestor.type === "ForOfStatement" ||
      ancestor.type === "WhileStatement" ||
      ancestor.type === "DoWhileStatement" ||
      ancestor.type === "SwitchStatement"
    )
      return [];
    if (isNodeOfType(ancestor, "IfStatement") && !isNodeOfType(ancestor.test, "Identifier"))
      return [];
    ancestor = ancestor.parent;
  }
  const statement = registration.parent;
  const block = statement?.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
    return [];
  let declaration: EsTreeNode | null = null;
  let conditional: EsTreeNode | null = null;
  for (const sibling of block.body) {
    if (sibling === statement) break;
    declaration = conditional;
    conditional = sibling;
  }
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "let" ||
    !isNodeOfType(conditional, "IfStatement") ||
    !conditional.alternate
  )
    return [];
  const [declarator, ...otherDeclarations] = declaration.declarations;
  if (
    otherDeclarations.length ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return [];
  const symbol = context.scopes.symbolFor(listener);
  if (
    !symbol ||
    symbol.kind !== "let" ||
    symbol.declarationNode !== declarator ||
    symbol.bindingIdentifier !== declarator.id
  )
    return [];
  const branches = getPredicateBranches(conditional.test, context);
  const consequent = getBranchAssignment(conditional.consequent, symbol, context);
  const alternate = getBranchAssignment(conditional.alternate, symbol, context);
  if (!branches || !consequent || !alternate) return [];
  const assignments = new Set<EsTreeNode>([consequent.assignment.left, alternate.assignment.left]);
  const cleanupFunctions = new Set(collectReturnedCleanupFunctions(effect, context.scopes));
  if (
    !symbol.references.every((reference) =>
      assignments.has(reference.identifier)
        ? reference.flag === "write"
        : reference.flag === "read" &&
          (reference.identifier === listener ||
            isMatchingCleanupReference(
              reference.identifier,
              registration,
              cleanupFunctions,
              context,
            )),
    )
  )
    return [];
  return [
    ...(branches.consequent && nodesCanCoExecute(consequent.assignment, registration, context)
      ? [consequent.callback]
      : []),
    ...(branches.alternate && nodesCanCoExecute(alternate.assignment, registration, context)
      ? [alternate.callback]
      : []),
  ];
};
