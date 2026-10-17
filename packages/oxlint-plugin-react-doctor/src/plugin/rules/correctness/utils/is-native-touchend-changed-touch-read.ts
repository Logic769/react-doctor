import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "../../../utils/get-react-doctor-setting.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_TOUCHEND_COORDINATE_NAMES,
  NATIVE_TOUCHEND_FIRST_CHANGED_INDEX,
  NATIVE_TOUCHEND_HANDLER_ATTRIBUTE_COUNT,
  NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN,
  NATIVE_TOUCHEND_PARAMETER_COUNT,
  NATIVE_TOUCHEND_PROVIDER_MODULES,
  NATIVE_TOUCHEND_UNSUPPORTED_GLOBAL_NAMES,
  NATIVE_TOUCHEND_UNSUPPORTED_PROGRAM_NODE_TYPES,
  NATIVE_TOUCHEND_UNSUPPORTED_PROPERTY_NAMES,
  NATIVE_TOUCHEND_UNSUPPORTED_PROVIDER_PREFIXES,
} from "./native-touchend/constants.js";

const readCoordinateFromEvent = (identifier: EsTreeNode): EsTreeNode | null => {
  const changedTouches = identifier.parent;
  const indexRead = changedTouches?.parent;
  const coordinate = indexRead?.parent;
  if (
    !isNodeOfType(changedTouches, "MemberExpression") ||
    changedTouches.object !== identifier ||
    changedTouches.computed ||
    changedTouches.optional ||
    !isNodeOfType(changedTouches.property, "Identifier") ||
    changedTouches.property.name !== "changedTouches" ||
    !isNodeOfType(indexRead, "MemberExpression") ||
    indexRead.object !== changedTouches ||
    !indexRead.computed ||
    indexRead.optional ||
    !isNodeOfType(indexRead.property, "Literal") ||
    indexRead.property.value !== NATIVE_TOUCHEND_FIRST_CHANGED_INDEX ||
    !isNodeOfType(coordinate, "MemberExpression") ||
    coordinate.object !== indexRead ||
    coordinate.computed ||
    coordinate.optional ||
    !isNodeOfType(coordinate.property, "Identifier") ||
    !NATIVE_TOUCHEND_COORDINATE_NAMES.has(coordinate.property.name) ||
    isMemberMutationTarget(coordinate)
  ) {
    return null;
  }
  const coordinateRoot = findTransparentExpressionRoot(coordinate);
  const consumer = coordinateRoot.parent;
  if (
    ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
      consumer.callee === coordinateRoot) ||
    (isNodeOfType(consumer, "MemberExpression") && consumer.object === coordinateRoot) ||
    (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === coordinateRoot)
  ) {
    return null;
  }
  return coordinate;
};

const hasReadonlyProviderReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    if (reference.flag !== "read") return false;
    const parent = identifier.parent;
    if (isNodeOfType(symbol.declarationNode, "ImportSpecifier")) {
      return (
        isNodeOfType(parent, "CallExpression") && parent.callee === identifier && !parent.optional
      );
    }
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== identifier) return false;
    const invocation = parent.parent;
    return (
      !parent.computed &&
      !parent.optional &&
      !isMemberMutationTarget(parent) &&
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === parent &&
      !invocation.optional
    );
  });

const hasSupportedTouchProgram = (context: RuleContext, parameterName: string): boolean => {
  const source = context.sourceCode?.getText?.();
  if (typeof source !== "string" || NATIVE_TOUCHEND_JSX_PRAGMA_PATTERN.test(source)) return false;
  let supported = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (
      NATIVE_TOUCHEND_UNSUPPORTED_PROGRAM_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration")) &&
      node.id.name === parameterName
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const reference = context.scopes.referenceFor(node);
      const symbol = reference?.resolvedSymbol;
      if (
        reference &&
        (symbol?.kind === "ts-interface" ||
          symbol?.kind === "ts-type-alias" ||
          (symbol?.kind === "import" && getValueImportSource(symbol) === null) ||
          (isNodeOfType(node, "Identifier") &&
            NATIVE_TOUCHEND_UNSUPPORTED_GLOBAL_NAMES.has(node.name)))
      ) {
        supported = false;
        return false;
      }
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
      if (name === null || NATIVE_TOUCHEND_UNSUPPORTED_PROPERTY_NAMES.has(name)) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    const source = String(node.source.value);
    if (
      NATIVE_TOUCHEND_UNSUPPORTED_PROVIDER_PREFIXES.some(
        (prefix) => source === prefix || source.startsWith(`${prefix}/`),
      )
    ) {
      supported = false;
      return false;
    }
    if (!NATIVE_TOUCHEND_PROVIDER_MODULES.has(source)) return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (symbol && getValueImportSource(symbol) && !hasReadonlyProviderReferences(symbol)) {
        supported = false;
        return false;
      }
    }
  });
  return supported;
};

export const isNativeTouchendChangedTouchRead = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const capabilities = getReactDoctorStringArraySetting(context.settings, "capabilities");
  if (
    getReactDoctorStringSetting(context.settings, "framework") !== "nextjs" ||
    !capabilities.includes("react:19") ||
    !capabilities.includes("nextjs") ||
    capabilities.some(
      (capability) =>
        capability.startsWith("react-native") ||
        capability === "pure-preact" ||
        capability.startsWith("preact") ||
        capability.startsWith("expo"),
    )
  ) {
    return false;
  }
  const handler = findEnclosingFunction(node);
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== NATIVE_TOUCHEND_PARAMETER_COUNT
  ) {
    return false;
  }
  const [parameter] = handler.params;
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const container = handler.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== handler ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    attribute.value !== container ||
    getJsxAttributeName(attribute.name) !== "onTouchEnd" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !HTML_TAGS.has(opening.name.name) ||
    opening.attributes.some(
      (candidate) =>
        isNodeOfType(candidate, "JSXSpreadAttribute") ||
        (isNodeOfType(candidate, "JSXAttribute") && getJsxAttributeName(candidate.name) === "is"),
    ) ||
    opening.attributes.filter(
      (candidate) =>
        isNodeOfType(candidate, "JSXAttribute") &&
        getJsxAttributeName(candidate.name) === "onTouchEnd",
    ).length !== NATIVE_TOUCHEND_HANDLER_ATTRIBUTE_COUNT
  ) {
    return false;
  }
  const symbol = context.scopes.symbolFor(parameter);
  if (!symbol || symbol.kind !== "parameter") return false;
  let selectedRead = false;
  if (
    !symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== handler) {
        return false;
      }
      const coordinate = readCoordinateFromEvent(reference.identifier);
      selectedRead ||= coordinate === node;
      return coordinate !== null;
    }) ||
    !selectedRead
  ) {
    return false;
  }
  let hasSuspension = false;
  walkAst(handler.body, (child) => {
    if (isNodeOfType(child, "AwaitExpression") || isNodeOfType(child, "YieldExpression")) {
      hasSuspension = true;
      return false;
    }
  });
  return !hasSuspension && hasSupportedTouchProgram(context, parameter.name);
};
