import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  IMPORTED_IMAGE_FIRST_ITEM_INDEX,
  IMPORTED_IMAGE_RUNTIME_TYPESCRIPT_NODES,
  IMPORTED_IMAGE_SINGLE_ITEM_COUNT,
  IMPORTED_IMAGE_UNSUPPORTED_GLOBAL_NAMES,
  IMPORTED_IMAGE_UNSUPPORTED_MEMBER_NAMES,
} from "./constants.js";

interface ImportedBundledImageSourcesInput {
  specifier: EsTreeNode;
  context: RuleContext;
  bundledAssetSourcePattern: RegExp;
}

const isSupportedAssetProgram = (scopes: ScopeAnalysis): boolean => {
  let supported = true;
  walkAst(scopes.rootScope.node, (node) => {
    if (!supported) return false;
    const isPropertyRead =
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"));
    const propertyName = isPropertyRead
      ? getResolvedStaticPropertyName(node, scopes, { stringifyNonStringLiterals: true })
      : null;
    if (
      ("declare" in node && node.declare === true) ||
      node.type === "WithStatement" ||
      node.type === "ImportExpression" ||
      IMPORTED_IMAGE_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      (isPropertyRead &&
        (IMPORTED_IMAGE_UNSUPPORTED_MEMBER_NAMES.has(propertyName ?? "") ||
          ("computed" in node && node.computed && propertyName === null)))
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      !scopes.referenceFor(node)
    )
      return undefined;
    const symbol = scopes.symbolFor(node);
    if (
      symbol?.kind === "ts-interface" ||
      symbol?.kind === "ts-type-alias" ||
      (symbol?.kind === "import" && !getValueImportDeclaration(symbol)) ||
      node.name === "arguments" ||
      (IMPORTED_IMAGE_UNSUPPORTED_GLOBAL_NAMES.has(node.name) && scopes.isGlobalReference(node))
    ) {
      supported = false;
      return false;
    }
    return undefined;
  });
  if (!supported) return false;
  for (const provider of scopes.rootScope.symbols) {
    const declaration = getValueImportDeclaration(provider);
    if (
      !isNodeOfType(declaration, "ImportDeclaration") ||
      declaration.source.value !== "react-native"
    )
      continue;
    const binding = provider.declarationNode;
    if (!isNodeOfType(binding, "ImportSpecifier") || getImportedName(binding) === "default") {
      if (provider.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
        return false;
    } else if (
      (getImportedName(binding) === "Image" || getImportedName(binding) === "ImageBackground") &&
      !isOnlyJsxImageReference(provider)
    )
      return false;
  }
  return true;
};

const hasOnlyReadonlyMapMembers = (symbol: SymbolDescriptor, keys: ReadonlySet<string>): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    const root = findTransparentExpressionRoot(identifier);
    const member = root.parent;
    return (
      reference.flag === "read" &&
      !isWithinAssignmentTarget(identifier) &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === root &&
      !member.optional &&
      keys.has(getStaticPropertyName(member) ?? "") &&
      !isNodeOfType(member.parent, "MemberExpression")
    );
  });

const isOnlyJsxImageReference = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isTypeScriptTypePosition(identifier)) return true;
    const parent = identifier.parent;
    return (
      reference.flag === "read" &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

export const hasOnlyImportedBundledImageSources = ({
  specifier,
  context,
  bundledAssetSourcePattern,
}: ImportedBundledImageSourcesInput): boolean => {
  if (!context.filename || !isNodeOfType(specifier, "ImportSpecifier")) return false;
  const scopes = context.scopes;
  const image = scopes.symbolFor(specifier.local);
  if (!image || !isSupportedAssetProgram(scopes)) return false;
  const openings = image.references
    .filter((reference) => !isTypeScriptTypePosition(reference.identifier))
    .map((reference) => reference.identifier.parent)
    .filter((node) => isNodeOfType(node, "JSXOpeningElement"));
  if (openings.length < IMPORTED_IMAGE_SINGLE_ITEM_COUNT) return false;
  for (const opening of openings) {
    if (!isNodeOfType(opening, "JSXOpeningElement")) return false;
    if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
      return false;
    const attributes = opening.attributes.filter(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "source",
    );
    const attribute = attributes[IMPORTED_IMAGE_FIRST_ITEM_INDEX];
    if (
      attributes.length !== IMPORTED_IMAGE_SINGLE_ITEM_COUNT ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(stripParenExpression(attribute.value.expression), "MemberExpression")
    )
      return false;
    const member = stripParenExpression(attribute.value.expression);
    if (!isNodeOfType(member, "MemberExpression") || member.optional) return false;
    const mapIdentifier = stripParenExpression(member.object);
    if (!isNodeOfType(mapIdentifier, "Identifier")) return false;
    const key = getStaticPropertyName(member);
    const map = scopes.symbolFor(mapIdentifier);
    const imported = map ? getValueImportDeclaration(map) : null;
    if (
      !key ||
      !map ||
      !isNodeOfType(map.declarationNode, "ImportSpecifier") ||
      !isNodeOfType(imported, "ImportDeclaration") ||
      typeof imported.source.value !== "string"
    )
      return false;
    const exportedName = getImportedName(map.declarationNode);
    if (!exportedName) return false;
    const directPath = resolveModulePath(context.filename, imported.source.value);
    const resolved = resolveCrossFileValueExportWithFilePath(
      context.filename,
      imported.source.value,
      exportedName,
    );
    if (
      !resolved ||
      resolved.filePath !== directPath ||
      !isNodeOfType(resolved.exportedNode, "ObjectExpression")
    )
      return false;
    const object = resolved.exportedNode;
    const objectRoot = findTransparentExpressionRoot(object);
    const declaration = objectRoot.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== objectRoot ||
      !isNodeOfType(declaration.id, "Identifier") ||
      declaration.id.name !== exportedName ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const" ||
      !isNodeOfType(declaration.parent.parent, "ExportNamedDeclaration")
    )
      return false;
    const exporterScopes = analyzeScopes(resolved.programNode);
    const exportedMap = exporterScopes.symbolFor(declaration.id);
    if (
      !exportedMap ||
      exporterScopes.scopeFor(declaration) !== exporterScopes.rootScope ||
      !isSupportedAssetProgram(exporterScopes) ||
      exporterScopes.rootScope.symbols.filter((symbol) => symbol.name === exportedName).length !==
        IMPORTED_IMAGE_SINGLE_ITEM_COUNT
    )
      return false;
    const keys = new Set<string>();
    for (const property of object.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init" ||
        !isNodeOfType(stripParenExpression(property.value), "Identifier")
      )
        return false;
      const propertyName = getStaticKeyName(property.key);
      const asset = exporterScopes.symbolFor(stripParenExpression(property.value));
      const assetImport = asset ? getValueImportDeclaration(asset) : null;
      if (
        propertyName === null ||
        keys.has(propertyName) ||
        !asset ||
        !isNodeOfType(asset.declarationNode, "ImportDefaultSpecifier") ||
        !isNodeOfType(assetImport, "ImportDeclaration") ||
        typeof assetImport.source.value !== "string" ||
        !bundledAssetSourcePattern.test(assetImport.source.value) ||
        asset.references.some((reference) => {
          if (isTypeScriptTypePosition(reference.identifier)) return false;
          const root = findTransparentExpressionRoot(reference.identifier);
          const parent = root.parent;
          return (
            reference.flag !== "read" ||
            isWithinAssignmentTarget(reference.identifier) ||
            !isNodeOfType(parent, "Property") ||
            parent.parent !== object ||
            (parent.value !== root && !(parent.shorthand && parent.key === root))
          );
        })
      )
        return false;
      keys.add(propertyName);
    }
    if (!keys.has(key) || !hasOnlyReadonlyMapMembers(exportedMap, keys)) return false;
    for (const alias of scopes.rootScope.symbols) {
      const aliasImport = getValueImportDeclaration(alias);
      if (
        !isNodeOfType(aliasImport, "ImportDeclaration") ||
        typeof aliasImport.source.value !== "string" ||
        resolveModulePath(context.filename, aliasImport.source.value) !== directPath
      )
        continue;
      const binding = alias.declarationNode;
      if (!isNodeOfType(binding, "ImportSpecifier")) {
        if (alias.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
          return false;
      } else if (
        getImportedName(binding) === exportedName &&
        !hasOnlyReadonlyMapMembers(alias, keys)
      )
        return false;
    }
  }
  return true;
};
