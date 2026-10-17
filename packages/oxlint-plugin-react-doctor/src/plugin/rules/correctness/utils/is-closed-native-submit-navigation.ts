import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isJsxFragmentElement } from "../../../utils/is-jsx-fragment-element.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT,
  NATIVE_SUBMIT_ATTRIBUTE_COUNT,
  NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT,
  NATIVE_SUBMIT_PROVIDER_MODULES,
  NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES,
  NATIVE_SUBMIT_UNSUPPORTED_GLOBALS,
} from "./constants.js";

interface NativeSubmitFunctionBinding {
  readonly functionNode:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">;
  readonly symbol: SymbolDescriptor;
}

const readDirectFunctionBinding = (
  node: EsTreeNode,
  context: RuleContext,
): NativeSubmitFunctionBinding | null => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") && !isNodeOfType(node, "FunctionExpression")) {
    return null;
  }
  const declaration = node.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== node ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    (isNodeOfType(node, "FunctionExpression") && node.id !== null)
  ) {
    return null;
  }
  const symbol = context.scopes.symbolFor(declaration.id);
  if (
    !symbol ||
    getDirectConstInitializer(symbol) !== node ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  return { functionNode: node, symbol };
};

const isDirectJsxTagReference = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === identifier,
  );
};

const hasClosedProviderReferences = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    if (reference.flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
    const parent = identifier.parent;
    if (getImportedName(symbol.declarationNode) === "Fragment") {
      return isDirectJsxTagReference(identifier);
    }
    if (
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === identifier &&
      !parent.optional
    ) {
      return true;
    }
    if (
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
    ) {
      return false;
    }
    if (
      isNodeOfType(parent, "JSXMemberExpression") &&
      parent.object === identifier &&
      parent.property.name === "Fragment"
    ) {
      return isDirectJsxTagReference(parent);
    }
    return false;
  });

const hasSupportedProgram = (program: EsTreeNode, context: RuleContext): boolean => {
  const source = context.sourceCode?.getText?.();
  if (source === undefined || /@jsx(?:\s|Frag|ImportSource|Runtime)/u.test(source)) return false;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      ("declare" in node && node.declare) ||
      NATIVE_SUBMIT_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
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
            NATIVE_SUBMIT_UNSUPPORTED_GLOBALS.has(node.name) &&
            (node.name === "eval" || !symbol)))
      ) {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration")) return;
    if (!NATIVE_SUBMIT_PROVIDER_MODULES.has(String(node.source.value))) return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (symbol && getValueImportSource(symbol) && !hasClosedProviderReferences(symbol)) {
        supported = false;
        return false;
      }
    }
  });
  return supported;
};

const isNativeContainer = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXSpreadAttribute") ||
        (isNodeOfType(attribute, "JSXAttribute") && getJsxAttributeName(attribute.name) === "is"),
    )
  ) {
    return false;
  }
  if (isNodeOfType(opening.name, "JSXIdentifier") && HTML_TAGS.has(opening.name.name)) {
    return true;
  }
  if (!isJsxFragmentElement(opening, context.scopes)) return false;
  const name = opening.name;
  const identifier = isNodeOfType(name, "JSXMemberExpression") ? name.object : name;
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  return Boolean(symbol && getValueImportSource(symbol) === "react");
};

const isReturnedForm = (
  form: EsTreeNodeOfType<"JSXElement">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode = form;
  for (;;) {
    const root = findTransparentExpressionRoot(current);
    const parent = root.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === root && findEnclosingFunction(parent) === component;
    }
    if (isNodeOfType(component, "ArrowFunctionExpression") && component.body === root) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === root || parent.alternate === root)
    ) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXFragment") && parent.children.some((child) => child === root)) {
      current = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "JSXElement") &&
      parent.children.some((child) => child === root) &&
      isNativeContainer(parent.openingElement, context)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
};

const isSubmitAnchor = (
  identifier: EsTreeNode,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const expression = identifier.parent;
  const attribute = expression?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(expression, "JSXExpressionContainer") ||
    expression.expression !== identifier ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.name.name !== "form" ||
    !isNativeContainer(opening, context) ||
    getAuthoritativeJsxAttribute(opening.attributes, "onSubmit") !== attribute ||
    opening.attributes.filter(
      (candidate) =>
        isNodeOfType(candidate, "JSXAttribute") &&
        getJsxAttributeName(candidate.name) === "onSubmit",
    ).length !== NATIVE_SUBMIT_ATTRIBUTE_COUNT ||
    !isNodeOfType(opening.parent, "JSXElement")
  ) {
    return false;
  }
  return isReturnedForm(opening.parent, component, context);
};

export const isClosedNativeSubmitNavigation = (
  call: EsTreeNodeOfType<"CallExpression">,
  navigateDeclaration: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): boolean => {
  if (
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isNodeOfType(navigateDeclaration.id, "Identifier") ||
    !isNodeOfType(navigateDeclaration.init, "CallExpression") ||
    navigateDeclaration.init.optional ||
    navigateDeclaration.init.arguments.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT ||
    !isNodeOfType(navigateDeclaration.init.callee, "Identifier")
  ) {
    return false;
  }
  const navigateSymbol = context.scopes.symbolFor(navigateDeclaration.id);
  const hookSymbol = context.scopes.symbolFor(navigateDeclaration.init.callee);
  const hookSource = hookSymbol && getValueImportSource(hookSymbol);
  if (
    !navigateSymbol ||
    getDirectConstInitializer(navigateSymbol) !== navigateDeclaration.init ||
    navigateSymbol.references.some((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return false;
      const parent = reference.identifier.parent;
      return (
        reference.flag !== "read" ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== reference.identifier ||
        parent.optional
      );
    }) ||
    !hookSymbol ||
    getImportedName(hookSymbol.declarationNode) !== "useNavigate" ||
    (hookSource !== "react-router" && hookSource !== "react-router-dom")
  ) {
    return false;
  }
  const helperNode = findEnclosingFunction(call);
  const helper = helperNode && readDirectFunctionBinding(helperNode, context);
  if (
    !helper ||
    helper.functionNode.generator ||
    helper.functionNode.params.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT ||
    helper.symbol.references.length === NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT
  ) {
    return false;
  }
  const component = findEnclosingFunction(helper.symbol.declarationNode);
  if (!component || findEnclosingFunction(navigateDeclaration) !== component) return false;
  const componentBinding = readDirectFunctionBinding(component, context);
  if (
    !componentBinding ||
    componentBinding.functionNode.async ||
    componentBinding.functionNode.generator ||
    !/^[A-Z]/u.test(componentBinding.symbol.name)
  ) {
    return false;
  }
  if (
    componentBinding.symbol.references.some((reference) => {
      const identifier = reference.identifier;
      return !(
        isDirectJsxTagReference(identifier) ||
        (isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
          identifier.parent.declaration === identifier)
      );
    })
  ) {
    return false;
  }
  let handler: NativeSubmitFunctionBinding | null = null;
  for (const reference of helper.symbol.references) {
    const helperCall = reference.identifier.parent;
    if (
      !isNodeOfType(helperCall, "CallExpression") ||
      helperCall.callee !== reference.identifier ||
      helperCall.optional ||
      helperCall.arguments.length !== NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT
    ) {
      return false;
    }
    const caller = findEnclosingFunction(helperCall);
    const binding = caller && readDirectFunctionBinding(caller, context);
    if (
      !binding ||
      binding.functionNode === helper.functionNode ||
      binding.functionNode.async ||
      binding.functionNode.generator ||
      binding.functionNode.params.length !== NATIVE_SUBMIT_HANDLER_PARAMETER_COUNT ||
      !binding.functionNode.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
      findEnclosingFunction(binding.symbol.declarationNode) !== component ||
      (handler !== null && handler.symbol !== binding.symbol)
    ) {
      return false;
    }
    handler = binding;
  }
  if (!handler || handler.symbol.references.length === NATIVE_SUBMIT_HELPER_ARGUMENT_COUNT) {
    return false;
  }
  if (
    !handler.symbol.references.every((reference) =>
      isSubmitAnchor(reference.identifier, component, context),
    )
  ) {
    return false;
  }
  const program = findProgramRoot(call);
  return Boolean(program && hasSupportedProgram(program, context));
};
