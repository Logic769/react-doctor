import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedJsxComponentName } from "../../../utils/resolve-imported-jsx-component-name.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  REACT_MARKDOWN_FIRST_VALUE_INDEX,
  REACT_MARKDOWN_RUNTIME_TYPESCRIPT_NODES,
  REACT_MARKDOWN_SINGLE_VALUE_COUNT,
} from "./constants.js";

export const isReactMarkdownCodeClassname = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "parameter") return false;
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    getStaticKeyName(property.key) !== "className" ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    pattern.properties.some((entry) => isNodeOfType(entry, "Property") && entry.computed) ||
    pattern.properties.filter(
      (entry) => isNodeOfType(entry, "Property") && getStaticKeyName(entry.key) === "className",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  const renderer = pattern.parent;
  if (
    (!isNodeOfType(renderer, "FunctionExpression") &&
      !isNodeOfType(renderer, "ArrowFunctionExpression")) ||
    renderer.async ||
    (isNodeOfType(renderer, "FunctionExpression") && (renderer.generator || renderer.id)) ||
    renderer.params.length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    renderer.params[REACT_MARKDOWN_FIRST_VALUE_INDEX] !== pattern
  ) {
    return false;
  }
  const rendererProperty = renderer.parent;
  const components = rendererProperty?.parent;
  if (
    !isNodeOfType(rendererProperty, "Property") ||
    rendererProperty.computed ||
    rendererProperty.kind !== "init" ||
    rendererProperty.value !== renderer ||
    getStaticKeyName(rendererProperty.key) !== "code" ||
    !isNodeOfType(components, "ObjectExpression") ||
    components.properties.some(
      (entry) => !isNodeOfType(entry, "Property") || entry.computed || entry.kind !== "init",
    ) ||
    components.properties.filter(
      (entry) => isNodeOfType(entry, "Property") && getStaticKeyName(entry.key) === "code",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT
  ) {
    return false;
  }
  const container = components.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "components" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.attributes.some((entry) => isNodeOfType(entry, "JSXSpreadAttribute")) ||
    opening.attributes.filter(
      (entry) =>
        isNodeOfType(entry, "JSXAttribute") &&
        isNodeOfType(entry.name, "JSXIdentifier") &&
        entry.name.name === "components",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    resolveImportedJsxComponentName(opening, "react-markdown", scopes) !== "default"
  ) {
    return false;
  }
  const provider = scopes.symbolFor(opening.name);
  if (!provider || !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier")) return false;
  const protectedNames = new Set([symbol.name]);
  for (const importedSymbol of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(importedSymbol);
    if (
      declaration?.source.value === "react-markdown" &&
      !isTypeOnlyImport(declaration) &&
      !(
        isNodeOfType(importedSymbol.declarationNode, "ImportSpecifier") &&
        importedSymbol.declarationNode.importKind === "type"
      )
    ) {
      protectedNames.add(importedSymbol.name);
    }
  }
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnsupportedRuntime) return false;
    if (
      ("declare" in node && node.declare === true) ||
      ((isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration")) &&
        protectedNames.has(node.id.name)) ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.specifiers.some(
          (specifier) =>
            protectedNames.has(specifier.local.name) &&
            (isTypeOnlyImport(node) ||
              (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")),
        )) ||
      node.type === "WithStatement" ||
      REACT_MARKDOWN_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      ((isNodeOfType(node, "TSEnumDeclaration") || isNodeOfType(node, "TSModuleDeclaration")) &&
        !node.declare)
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isAstDescendant(node, renderer) &&
      (isNodeOfType(node, "ThisExpression") ||
        (isNodeOfType(node, "Identifier") &&
          node.name === "arguments" &&
          scopes.referenceFor(node) !== null))
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && node.name === "eval") {
      const selectedSymbol = scopes.symbolFor(node);
      const imported = selectedSymbol ? getImportDeclarationForSymbol(selectedSymbol) : null;
      if (
        selectedSymbol?.bindingIdentifier !== node &&
        (scopes.isGlobalReference(node) ||
          selectedSymbol?.kind === "ts-interface" ||
          selectedSymbol?.kind === "ts-type-alias" ||
          (imported &&
            (isTypeOnlyImport(imported) ||
              (isNodeOfType(selectedSymbol?.declarationNode, "ImportSpecifier") &&
                selectedSymbol.declarationNode.importKind === "type"))))
      ) {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.source.value !== "react-markdown" ||
      isTypeOnlyImport(node)
    ) {
      return undefined;
    }
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const importedSymbol = scopes.symbolFor(specifier.local);
      if (!isNodeOfType(specifier, "ImportDefaultSpecifier") || !importedSymbol) {
        hasUnsupportedRuntime = true;
        return false;
      }
      for (const reference of importedSymbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const parent = reference.identifier.parent;
        if (
          reference.flag !== "read" ||
          isWithinAssignmentTarget(reference.identifier) ||
          !isNodeOfType(reference.identifier, "JSXIdentifier") ||
          (!isNodeOfType(parent, "JSXOpeningElement") &&
            !isNodeOfType(parent, "JSXClosingElement")) ||
          parent.name !== reference.identifier
        ) {
          hasUnsupportedRuntime = true;
          return false;
        }
      }
    }
    return undefined;
  });
  return !hasUnsupportedRuntime;
};
