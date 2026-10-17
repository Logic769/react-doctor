import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { isFunctionLike } from "./is-function-like.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import {
  NATIVE_KEYS_CALL_ARGUMENT_COUNT,
  NATIVE_KEYS_FOR_OF_DECLARATION_COUNT,
  NATIVE_KEYS_ITERATION_ARGUMENT_COUNT,
  NATIVE_KEYS_ITERATION_METHOD_NAMES,
  NATIVE_KEYS_UNSUPPORTED_GLOBAL_NAMES,
  NATIVE_KEYS_UNSUPPORTED_PROGRAM_NODE_TYPES,
  NATIVE_KEYS_UNSUPPORTED_PROPERTY_NAMES,
} from "./native-object-keys-iteration/constants.js";
import { walkAst } from "./walk-ast.js";

const supportedProgramByScope = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

const hasSupportedNativeKeysProgram = (scopes: ScopeAnalysis, inputName: string): boolean => {
  let cachedNames = supportedProgramByScope.get(scopes);
  const cached = cachedNames?.get(inputName);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (
      NATIVE_KEYS_UNSUPPORTED_PROGRAM_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration")) &&
      (node.id.name === inputName || node.id.name === "Object")
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes);
      const pattern = isNodeOfType(node, "Property") ? node.parent : null;
      const patternOwner = pattern?.parent;
      const selectedReceiver = isNodeOfType(node, "MemberExpression")
        ? node.object
        : isNodeOfType(pattern, "ObjectPattern") &&
            isNodeOfType(patternOwner, "VariableDeclarator") &&
            patternOwner.id === pattern
          ? patternOwner.init
          : isNodeOfType(pattern, "ObjectPattern") &&
              isNodeOfType(patternOwner, "AssignmentExpression") &&
              patternOwner.left === pattern
            ? patternOwner.right
            : null;
      if (
        node.computed &&
        propertyName === null &&
        selectedReceiver &&
        isKnownIntrinsicCapableComputedReceiver(selectedReceiver, scopes)
      ) {
        supported = false;
        return false;
      }
      if (
        propertyName !== null &&
        (NATIVE_KEYS_UNSUPPORTED_PROPERTY_NAMES.has(propertyName) ||
          (isNodeOfType(node, "MemberExpression") &&
            NATIVE_KEYS_ITERATION_METHOD_NAMES.has(propertyName) &&
            (!isNodeOfType(node.parent, "CallExpression") || node.parent.callee !== node)))
      ) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = scopes.referenceFor(node);
    if (!reference) return;
    const symbol = reference.resolvedSymbol;
    if (
      NATIVE_KEYS_UNSUPPORTED_GLOBAL_NAMES.has(node.name) ||
      symbol?.kind === "ts-interface" ||
      symbol?.kind === "ts-type-alias" ||
      (symbol?.kind === "import" && getValueImportDeclaration(symbol) === null) ||
      isProvenGlobalObjectReference(node, scopes)
    ) {
      supported = false;
      return false;
    }
    if (node.name !== "Object" || !scopes.isGlobalReference(node)) return;
    const member = node.parent;
    const call = member?.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      member.property.name !== "keys" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional ||
      call.arguments.length !== NATIVE_KEYS_CALL_ARGUMENT_COUNT ||
      isNodeOfType(call.arguments[0], "SpreadElement")
    )
      supported = false;
  });
  if (!cachedNames) {
    cachedNames = new Map();
    supportedProgramByScope.set(scopes, cachedNames);
  }
  cachedNames.set(inputName, supported);
  return supported;
};

const isKnownNonNativeIterationReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let selected = stripParenExpression(receiver);
  if (isNodeOfType(selected, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(selected, scopes);
    if (symbol && isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return true;
    if (symbol?.initializer) selected = stripParenExpression(symbol.initializer);
  }
  return (
    isNodeOfType(selected, "ObjectExpression") ||
    isFunctionLike(selected) ||
    isNodeOfType(selected, "Literal")
  );
};

const isKnownIntrinsicCapableComputedReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let selected = stripParenExpression(receiver);
  if (isNodeOfType(selected, "Identifier")) {
    const symbol = resolveConstIdentifierAlias(selected, scopes);
    if (symbol?.initializer) selected = stripParenExpression(symbol.initializer);
  }
  return (
    isNodeOfType(selected, "Literal") ||
    isNodeOfType(selected, "TemplateLiteral") ||
    isNodeOfType(selected, "ObjectExpression") ||
    isNodeOfType(selected, "ArrayExpression") ||
    isFunctionLike(selected)
  );
};

const isOwnedIterationInput = (
  receiver: EsTreeNode,
  input: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = receiver.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const call = ancestor.parent;
      if (
        !isInlineFunctionExpression(ancestor) ||
        ancestor.async ||
        ancestor.generator ||
        (isNodeOfType(ancestor, "FunctionExpression") && ancestor.id !== null) ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.arguments.length !== NATIVE_KEYS_ITERATION_ARGUMENT_COUNT ||
        call.arguments[0] !== ancestor ||
        !isNodeOfType(call.callee, "MemberExpression") ||
        call.callee.optional ||
        call.callee.computed ||
        !isNodeOfType(call.callee.property, "Identifier") ||
        !NATIVE_KEYS_ITERATION_METHOD_NAMES.has(call.callee.property.name) ||
        isKnownNonNativeIterationReceiver(call.callee.object, scopes)
      )
        return false;
      if (ancestor.params[0] === input.bindingIdentifier) {
        return input.kind === "parameter" && isNodeOfType(ancestor.params[0], "Identifier");
      }
    }
    if (isNodeOfType(ancestor, "ForOfStatement")) {
      const declaration = ancestor.left;
      if (
        !ancestor.await &&
        !isKnownNonNativeIterationReceiver(ancestor.right, scopes) &&
        isNodeOfType(declaration, "VariableDeclaration") &&
        declaration.kind === "const" &&
        declaration.declarations.length === NATIVE_KEYS_FOR_OF_DECLARATION_COUNT &&
        declaration.declarations[0].id === input.bindingIdentifier &&
        input.declarationNode === declaration.declarations[0] &&
        isNodeOfType(input.bindingIdentifier, "Identifier")
      )
        return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const isNativeObjectKeysIterationReceiver = (
  receiver: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(receiver, "CallExpression") ||
    receiver.optional ||
    receiver.arguments.length !== NATIVE_KEYS_CALL_ARGUMENT_COUNT ||
    !isNodeOfType(receiver.callee, "MemberExpression") ||
    receiver.callee.computed ||
    receiver.callee.optional ||
    !isNodeOfType(receiver.callee.object, "Identifier") ||
    receiver.callee.object.name !== "Object" ||
    !scopes.isGlobalReference(receiver.callee.object) ||
    !isNodeOfType(receiver.callee.property, "Identifier") ||
    receiver.callee.property.name !== "keys"
  )
    return false;
  const argument = receiver.arguments[0];
  if (!isNodeOfType(argument, "Identifier")) return false;
  const input = scopes.referenceFor(argument)?.resolvedSymbol;
  if (
    !input ||
    !input.references.every((reference) => reference.flag === "read") ||
    !isOwnedIterationInput(receiver, input, scopes)
  )
    return false;
  return hasSupportedNativeKeysProgram(scopes, argument.name);
};
