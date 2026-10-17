import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isImportedFromReact, isReactNamespaceImport } from "../../../utils/is-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  UNSUPPORTED_PROVIDER_GLOBALS,
  UNSUPPORTED_PROVIDER_SELECTORS,
  UNSUPPORTED_RUNTIME_TYPES,
} from "./callback-map-snapshot/constants.js";
import { isReadonlyCallbackMapSymbol as isReadonly } from "./is-readonly-callback-map-symbol.js";

const isDirectInvocation = (node: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === expression,
  );
};

const hasCallableUse = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visited = new Set<number>(),
): boolean => {
  const expression = findTransparentExpressionRoot(node);
  const parent = expression.parent;
  if (!parent) return true;
  if (isDirectInvocation(expression) || isWithinAssignmentTarget(expression)) return true;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    (isNodeOfType(parent, "LogicalExpression") &&
      (parent.left === expression || parent.right === expression)) ||
    (isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === expression || parent.alternate === expression))
  ) {
    return hasCallableUse(parent, scopes, visited);
  }
  if (
    isNodeOfType(parent, "TaggedTemplateExpression") ||
    isNodeOfType(parent, "AwaitExpression") ||
    isNodeOfType(parent, "YieldExpression") ||
    isNodeOfType(parent, "SequenceExpression") ||
    isNodeOfType(parent, "AssignmentExpression") ||
    isNodeOfType(parent, "SpreadElement") ||
    isNodeOfType(parent, "Property") ||
    isNodeOfType(parent, "ArrayExpression") ||
    isNodeOfType(parent, "ReturnStatement")
  )
    return true;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === expression) {
    if (!isNodeOfType(parent.id, "Identifier")) return true;
    const symbol = scopes.symbolFor(parent.id);
    if (!symbol || symbol.kind !== "const" || !isReadonly(symbol) || visited.has(symbol.id))
      return true;
    const nextVisited = new Set([...visited, symbol.id]);
    return symbol.references.some((reference) =>
      hasCallableUse(reference.identifier, scopes, nextVisited),
    );
  }
  return false;
};

const hasClosedReactProvider = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedNodes: ReadonlySet<EsTreeNode>,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (
    !symbol ||
    !isReadonly(symbol) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type") ||
    (isNodeOfType(symbol.declarationNode.parent, "ImportDeclaration") &&
      symbol.declarationNode.parent.importKind === "type")
  )
    return false;
  const isNamespace = isReactNamespaceImport(identifier, scopes);
  if (
    !isNamespace &&
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      getImportedName(symbol.declarationNode) === "default")
  )
    return false;
  return symbol.references.every(({ identifier: reference }) => {
    if (isTypeScriptTypePosition(reference)) return true;
    if (!isNamespace) return isDirectInvocation(reference);
    const member = reference.parent;
    return Boolean(
      member &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === reference &&
      !member.computed &&
      !member.optional &&
      (allowedNodes.has(member) || isDirectInvocation(member)),
    );
  });
};

export const hasSupportedCallbackMapProgram = (
  scopes: ScopeAnalysis,
  allowedNodes: ReadonlySet<EsTreeNode> = new Set(),
): boolean => {
  let supported = true;
  const checkedReactSymbols = new Set<number>();
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (("declare" in node && node.declare === true) || UNSUPPORTED_RUNTIME_TYPES.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const reference = scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      if (
        reference &&
        (symbol?.kind === "ts-interface" ||
          symbol?.kind === "ts-type-alias" ||
          (UNSUPPORTED_PROVIDER_GLOBALS.has(node.name) &&
            (node.name === "eval" || scopes.isGlobalReference(node)) &&
            !allowedNodes.has(node)))
      )
        supported = false;
      if (symbol && isImportedFromReact(symbol) && !checkedReactSymbols.has(symbol.id)) {
        checkedReactSymbols.add(symbol.id);
        if (!hasClosedReactProvider(node, scopes, allowedNodes)) supported = false;
      }
      if (
        reference &&
        node.name === "Map" &&
        scopes.isGlobalReference(node) &&
        !isDirectInvocation(node)
      )
        supported = false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes, {
        allowConstTemplateLiteral: true,
        allowConstNumericLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName && UNSUPPORTED_PROVIDER_SELECTORS.has(propertyName)) supported = false;
      if (
        !propertyName &&
        node.computed &&
        (isNodeOfType(node, "Property") || hasCallableUse(node, scopes))
      )
        supported = false;
    }
    return undefined;
  });
  return supported;
};
