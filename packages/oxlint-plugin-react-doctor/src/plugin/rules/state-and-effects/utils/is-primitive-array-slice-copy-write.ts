import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  ARRAY_INTEGRITY_GLOBAL_NAMES,
  ARRAY_PROVIDER_PROPERTY_NAMES,
  EVALUATED_TYPESCRIPT_NODE_TYPES,
  FRESH_SLICE_UPDATER_STATEMENT_COUNT,
  NATIVE_SLICE_MAX_ARGUMENT_COUNT,
  PRIMITIVE_ARRAY_ELEMENT_TYPES,
  READONLY_ARRAY_STATIC_METHODS,
  READONLY_REACT_DEPENDENCY_HOOKS,
  SINGLE_ARGUMENT_COUNT,
  SINGLE_BINDING_COUNT,
  SINGLE_PARAMETER_COUNT,
  STATE_PAIR_ELEMENT_COUNT,
} from "./primitive-slice-copy/constants.js";

const isPrimitiveInput = (
  expression: EsTreeNode,
  annotationType: string,
  context: RuleContext,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal"))
    return (
      typeof candidate.value === PRIMITIVE_ARRAY_ELEMENT_TYPES.get(annotationType) &&
      (typeof candidate.value !== "number" || Number.isFinite(candidate.value))
    );
  if (annotationType === "TSNumberKeyword" && isNodeOfType(candidate, "UnaryExpression"))
    return (
      (candidate.operator === "+" || candidate.operator === "-") &&
      isNodeOfType(candidate.argument, "Literal") &&
      typeof candidate.argument.value === "number" &&
      Number.isFinite(candidate.argument.value)
    );
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  return Boolean(
    symbol?.kind === "parameter" &&
    !isNodeOfType(symbol.bindingIdentifier.parent, "AssignmentPattern") &&
    getSymbolTypeAnnotation(symbol)?.type === annotationType &&
    symbol.references.every((reference) => reference.flag === "read"),
  );
};

const isReadonlyNumericLoopBinding = (
  identifier: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(identifier);
  const declarator = symbol?.declarationNode;
  const declaration = declarator?.parent;
  const loop = declaration?.parent;
  if (
    !symbol ||
    symbol.kind !== "let" ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.id !== symbol.bindingIdentifier ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== SINGLE_BINDING_COUNT ||
    !isNodeOfType(loop, "ForStatement") ||
    loop.init !== declaration ||
    !isNodeOfType(declarator.init, "Literal") ||
    typeof declarator.init.value !== "number" ||
    !Number.isFinite(declarator.init.value) ||
    !isNodeOfType(loop.update, "UpdateExpression") ||
    loop.update.operator !== "++" ||
    !isNodeOfType(loop.update.argument, "Identifier") ||
    context.scopes.symbolFor(loop.update.argument)?.id !== symbol.id
  )
    return false;
  const update = loop.update;
  return symbol.references.every(
    (reference) => reference.flag === "read" || reference.identifier === update.argument,
  );
};

const isNumericStateIndex = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (isPrimitiveInput(candidate, "TSNumberKeyword", context)) return true;
  if (isNodeOfType(candidate, "Identifier"))
    return isReadonlyNumericLoopBinding(candidate, context);
  return (
    isNodeOfType(candidate, "BinaryExpression") &&
    candidate.operator === "-" &&
    isNodeOfType(candidate.left, "Identifier") &&
    isReadonlyNumericLoopBinding(candidate.left, context) &&
    isNodeOfType(candidate.right, "Literal") &&
    typeof candidate.right.value === "number" &&
    Number.isFinite(candidate.right.value)
  );
};

const hasReadonlyCallReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const root = findTransparentExpressionRoot(reference.identifier);
    return (
      reference.flag === "read" &&
      isNodeOfType(root.parent, "CallExpression") &&
      root.parent.callee === root &&
      !root.parent.optional
    );
  });

const hasClosedNamedImports = (
  declaration: EsTreeNodeOfType<"ImportDeclaration">,
  context: RuleContext,
): boolean =>
  declaration.specifiers.every((specifier) => {
    const symbol = context.scopes.symbolFor(specifier.local);
    if (!symbol) return false;
    const runtimeReferences = symbol.references.filter(
      (reference) => !isTypeScriptTypePosition(reference.identifier),
    );
    if (runtimeReferences.length === 0) return true;
    return (
      !isTypeOnlyImport(declaration) &&
      isNodeOfType(specifier, "ImportSpecifier") &&
      specifier.importKind !== "type" &&
      hasReadonlyCallReferences(symbol)
    );
  });

const isPrimitiveArrayLiteral = (expression: EsTreeNode, annotationType: string): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    isNodeOfType(candidate, "ArrayExpression") &&
    candidate.elements.every(
      (element) =>
        element !== null &&
        isNodeOfType(element, "Literal") &&
        typeof element.value === PRIMITIVE_ARRAY_ELEMENT_TYPES.get(annotationType) &&
        (typeof element.value !== "number" || Number.isFinite(element.value)),
    )
  );
};

const hasClosedSetterWrites = (
  setter: SymbolDescriptor,
  updater: EsTreeNode,
  annotationType: string,
  context: RuleContext,
): boolean =>
  setter.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== SINGLE_ARGUMENT_COUNT
    )
      return false;
    const argument = call.arguments[0];
    if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
    const value = stripParenExpression(argument);
    if (value === updater || isPrimitiveArrayLiteral(value, annotationType)) return true;
    if (!isNodeOfType(value, "CallExpression") || value.optional) return false;
    const callee = stripParenExpression(value.callee);
    if (!isNodeOfType(callee, "Identifier")) return false;
    const producer = context.scopes.symbolFor(callee);
    const declaration = producer ? getImportDeclarationForSymbol(producer) : null;
    const program = declaration ? findProgramRoot(declaration) : null;
    return Boolean(
      producer &&
      isNodeOfType(producer.declarationNode, "ImportSpecifier") &&
      producer.declarationNode.importKind !== "type" &&
      declaration &&
      declaration.source.value !== "react" &&
      isNodeOfType(program, "Program") &&
      program.body.every(
        (statement) =>
          !isNodeOfType(statement, "ImportDeclaration") ||
          statement.source.value !== declaration.source.value ||
          hasClosedNamedImports(statement, context),
      ) &&
      hasReadonlyCallReferences(producer),
    );
  });

const isUnexposedStateArray = (symbol: SymbolDescriptor, context: RuleContext): boolean =>
  symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    const root = findTransparentExpressionRoot(reference.identifier);
    const parent = root.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === root &&
      parent.computed &&
      !parent.optional
    )
      return isNumericStateIndex(parent.property, context) && !isWithinAssignmentTarget(parent);
    if (!isNodeOfType(parent, "ArrayExpression")) return false;
    const call = parent.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.arguments[1] === parent &&
      [...READONLY_REACT_DEPENDENCY_HOOKS].some((name) =>
        isReactApiCall(call, name, context.scopes, { resolveNamedAliases: true }),
      )
    );
  });

const hasClosedArrayProviders = (
  program: EsTreeNodeOfType<"Program">,
  state: SymbolDescriptor,
  selectedWrite: EsTreeNode,
  context: RuleContext,
): boolean => {
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      ("declare" in node && node.declare === true) ||
      EVALUATED_TYPESCRIPT_NODE_TYPES.has(node.type) ||
      isNodeOfType(node, "WithStatement")
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === "react" &&
      !hasClosedNamedImports(node, context)
    ) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const name = getResolvedStaticPropertyName(node, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      const numericStateRead =
        isNodeOfType(node, "MemberExpression") &&
        isNodeOfType(node.object, "Identifier") &&
        context.scopes.symbolFor(node.object)?.id === state.id &&
        isNumericStateIndex(node.property, context);
      if (name === null && node.computed && node !== selectedWrite && !numericStateRead) {
        isClosed = false;
        return false;
      }
      if (name !== null && ARRAY_PROVIDER_PROPERTY_NAMES.has(name)) {
        isClosed = false;
        return false;
      }
      if (
        isNodeOfType(node, "MemberExpression") &&
        name === "slice" &&
        isWithinAssignmentTarget(node)
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || !context.scopes.referenceFor(node)) return;
    const symbol = context.scopes.symbolFor(node);
    const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
    if (
      symbol &&
      (symbol.kind === "ts-interface" ||
        symbol.kind === "ts-type-alias" ||
        (declaration &&
          (isTypeOnlyImport(declaration) ||
            (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
              symbol.declarationNode.importKind === "type"))))
    ) {
      isClosed = false;
      return false;
    }
    if (
      node.name === "arguments" ||
      isProvenGlobalObjectReference(node, context.scopes) ||
      [...ARRAY_INTEGRITY_GLOBAL_NAMES].some(
        (name) => name !== "Array" && isProvenGlobalNamespaceReference(node, name, context.scopes),
      )
    ) {
      isClosed = false;
      return false;
    }
    if (!isProvenGlobalNamespaceReference(node, "Array", context.scopes)) return;
    const member = findTransparentExpressionRoot(node).parent;
    const call = member ? findTransparentExpressionRoot(member).parent : null;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.optional ||
      member.computed ||
      !READONLY_ARRAY_STATIC_METHODS.has(getStaticPropertyName(member) ?? "") ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== member
    ) {
      isClosed = false;
      return false;
    }
  });
  return isClosed;
};

export const isPrimitiveArraySliceCopyWrite = (
  write: EsTreeNode,
  updater: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    (!isNodeOfType(updater, "ArrowFunctionExpression") &&
      !isNodeOfType(updater, "FunctionExpression")) ||
    updater.async ||
    ("generator" in updater && updater.generator) ||
    !isNodeOfType(updater.body, "BlockStatement") ||
    updater.params.length !== SINGLE_PARAMETER_COUNT ||
    !isNodeOfType(updater.params[0], "Identifier") ||
    updater.body.body.length !== FRESH_SLICE_UPDATER_STATEMENT_COUNT ||
    !setterCall.arguments[0] ||
    stripParenExpression(setterCall.arguments[0]) !== updater
  )
    return false;
  const [declaration, expressionStatement, returned] = updater.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== SINGLE_BINDING_COUNT ||
    !isNodeOfType(expressionStatement, "ExpressionStatement") ||
    expressionStatement.expression !== write ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  )
    return false;
  const returnedValue = stripParenExpression(returned.argument);
  if (!isNodeOfType(returnedValue, "Identifier")) return false;
  const declarator = declaration.declarations[0];
  const target = stripParenExpression(write.left);
  if (
    !declarator ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !declarator.init ||
    !isNodeOfType(target, "MemberExpression") ||
    !target.computed ||
    !isNodeOfType(target.object, "Identifier")
  )
    return false;
  const copy = context.scopes.symbolFor(declarator.id);
  const parameter = context.scopes.symbolFor(updater.params[0]);
  if (
    !copy ||
    !parameter ||
    parameter.kind !== "parameter" ||
    context.scopes.symbolFor(target.object)?.id !== copy.id ||
    context.scopes.symbolFor(returnedValue)?.id !== copy.id ||
    !copy.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" &&
          (reference.identifier === target.object || reference.identifier === returnedValue)),
    )
  )
    return false;
  const slice = stripParenExpression(declarator.init);
  if (
    !isNodeOfType(slice, "CallExpression") ||
    slice.optional ||
    slice.arguments.length > NATIVE_SLICE_MAX_ARGUMENT_COUNT
  )
    return false;
  const member = stripParenExpression(slice.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    getStaticPropertyName(member) !== "slice" ||
    !isNodeOfType(member.object, "Identifier") ||
    context.scopes.symbolFor(member.object)?.id !== parameter.id ||
    !parameter.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" && reference.identifier === member.object),
    ) ||
    !slice.arguments.every(
      (argument) =>
        !isNodeOfType(argument, "SpreadElement") &&
        isPrimitiveInput(argument, "TSNumberKeyword", context),
    )
  )
    return false;
  const setter = stripParenExpression(setterCall.callee);
  const pair = resolveReactUseStatePair(setter, context.scopes);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !isNodeOfType(pair.declarator.parent, "VariableDeclaration") ||
    pair.declarator.parent.kind !== "const" ||
    !isNodeOfType(pair.declarator.id, "ArrayPattern") ||
    pair.declarator.id.elements.length !== STATE_PAIR_ELEMENT_COUNT ||
    pair.declarator.init.arguments.length !== SINGLE_ARGUMENT_COUNT ||
    context.scopes.symbolFor(setter)?.id !== pair.setterSymbol.id
  )
    return false;
  const hook = stripParenExpression(pair.declarator.init.callee);
  const hookSymbol = isNodeOfType(hook, "Identifier") ? context.scopes.symbolFor(hook) : null;
  const specifier = hookSymbol?.declarationNode;
  const imported = specifier?.parent;
  if (
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    specifier.imported.name !== "useState" ||
    !isNodeOfType(imported, "ImportDeclaration") ||
    imported.importKind === "type" ||
    imported.source.value !== "react"
  )
    return false;
  const annotation = pair.declarator.init.typeArguments?.params[0];
  if (
    !isNodeOfType(annotation, "TSArrayType") ||
    !PRIMITIVE_ARRAY_ELEMENT_TYPES.has(annotation.elementType.type)
  )
    return false;
  const initial = pair.declarator.init.arguments[0];
  if (
    !isNodeOfType(initial, "ArrayExpression") ||
    !initial.elements.every(
      (element) =>
        element !== null &&
        !isNodeOfType(element, "SpreadElement") &&
        isNodeOfType(element, "Literal") &&
        typeof element.value === PRIMITIVE_ARRAY_ELEMENT_TYPES.get(annotation.elementType.type),
    )
  )
    return false;
  if (
    !isPrimitiveInput(target.property, "TSNumberKeyword", context) ||
    !isPrimitiveInput(write.right, annotation.elementType.type, context) ||
    !isUnexposedStateArray(pair.stateSymbol, context) ||
    !hasClosedSetterWrites(pair.setterSymbol, updater, annotation.elementType.type, context)
  )
    return false;
  const program = findProgramRoot(updater);
  return (
    isNodeOfType(program, "Program") &&
    hasClosedArrayProviders(program, pair.stateSymbol, target, context)
  );
};
