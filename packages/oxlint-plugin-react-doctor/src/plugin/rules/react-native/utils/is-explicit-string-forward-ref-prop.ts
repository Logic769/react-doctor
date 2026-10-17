import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FIRST_NATIVE_PROP_BINDING_INDEX,
  FORWARD_REF_CALLBACK_ARGUMENT_COUNT,
  FORWARD_REF_MAX_PARAMETER_COUNT,
  SINGLE_STRING_PROP_DECLARATION_COUNT,
  STRING_PROP_RUNTIME_TYPESCRIPT_NODES,
  STRING_PROP_PROVIDER_HAZARD_NAMES,
  STRING_PROP_GLOBAL_CARRIER_NAMES,
} from "./constants.js";

export const isExplicitStringForwardRefProp = (
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
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern")
  ) {
    return false;
  }
  const callback = pattern.parent;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.typeParameters ||
    callback.params[FIRST_NATIVE_PROP_BINDING_INDEX] !== pattern ||
    callback.params.length > FORWARD_REF_MAX_PARAMETER_COUNT
  ) {
    return false;
  }
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== FORWARD_REF_CALLBACK_ARGUMENT_COUNT ||
    call.arguments[FIRST_NATIVE_PROP_BINDING_INDEX] !== callback ||
    !isReactApiCall(call, "forwardRef", scopes)
  ) {
    return false;
  }
  const callee = call.callee;
  let providerIdentifier: EsTreeNodeOfType<"Identifier"> | null = null;
  if (isNodeOfType(callee, "Identifier")) {
    providerIdentifier = callee;
  } else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier")
  ) {
    providerIdentifier = callee.object;
  }
  if (!providerIdentifier) return false;
  const providerSymbol = scopes.symbolFor(providerIdentifier);
  const specifier = providerSymbol?.declarationNode;
  const declaration = specifier?.parent;
  if (
    !providerSymbol ||
    providerSymbol.kind !== "import" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
  ) {
    return false;
  }
  if (
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  const annotation = pattern.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const typeNode = annotation.typeAnnotation;
  let members: ReadonlyArray<EsTreeNode>;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) {
    members = typeNode.members;
  } else if (
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    !typeNode.typeArguments
  ) {
    const interfaceName = typeNode.typeName.name;
    let signatureScope: ScopeDescriptor | null = scopes.scopeFor(callback);
    let interfaceDeclaration: EsTreeNode | null = null;
    while (signatureScope) {
      const declarations = signatureScope.symbols.filter(
        (candidate) => candidate.name === interfaceName,
      );
      if (declarations.length) {
        if (declarations.length !== SINGLE_STRING_PROP_DECLARATION_COUNT) return false;
        interfaceDeclaration = declarations[FIRST_NATIVE_PROP_BINDING_INDEX].declarationNode;
        break;
      }
      signatureScope = signatureScope.parent;
    }
    if (
      !isNodeOfType(interfaceDeclaration, "TSInterfaceDeclaration") ||
      interfaceDeclaration.typeParameters ||
      scopes.scopeFor(interfaceDeclaration) !== signatureScope
    ) {
      return false;
    }
    members = interfaceDeclaration.body.body;
  } else {
    return false;
  }
  const propertyName = getStaticKeyName(property.key);
  if (propertyName === null) return false;
  const matchingMembers = members.filter(
    (member) => "key" in member && getStaticKeyName(member.key) === propertyName,
  );
  if (matchingMembers.length !== SINGLE_STRING_PROP_DECLARATION_COUNT) return false;
  const selectedMember = matchingMembers[FIRST_NATIVE_PROP_BINDING_INDEX];
  if (
    !isNodeOfType(selectedMember, "TSPropertySignature") ||
    selectedMember.computed ||
    !isNodeOfType(selectedMember.typeAnnotation?.typeAnnotation, "TSStringKeyword")
  ) {
    return false;
  }
  if (
    isNodeOfType(typeNode, "TSTypeLiteral") &&
    !isNodeOfType(getSymbolTypeAnnotation(symbol), "TSStringKeyword")
  ) {
    return false;
  }
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnsupportedRuntime) return false;
    if (
      node.type === "WithStatement" ||
      STRING_PROP_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      ((isNodeOfType(node, "TSEnumDeclaration") || isNodeOfType(node, "TSModuleDeclaration")) &&
        !node.declare)
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const binding = scopes.symbolFor(node);
      const reference = findTransparentExpressionRoot(node);
      const parent = reference.parent;
      const isCarrier = STRING_PROP_GLOBAL_CARRIER_NAMES.has(node.name);
      const isCarrierMember =
        isNodeOfType(parent, "MemberExpression") && parent.object === reference;
      const memberName = isCarrierMember ? getStaticPropertyName(parent) : null;
      const isHarmlessCarrierCheck =
        isNodeOfType(parent, "UnaryExpression") &&
        (parent.operator === "typeof" || parent.operator === "void");
      const exposesProvider = isCarrier
        ? isCarrierMember
          ? memberName === null || STRING_PROP_PROVIDER_HAZARD_NAMES.includes(memberName)
          : !isHarmlessCarrierCheck
        : STRING_PROP_PROVIDER_HAZARD_NAMES.includes(node.name);
      if (
        exposesProvider &&
        binding?.bindingIdentifier !== node &&
        (scopes.isGlobalReference(node) ||
          Boolean(
            binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding),
          ))
      ) {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        !isTypeOnlyImport(node) &&
        (node.source.value === "module" || node.source.value === "node:module")) ||
      (isNodeOfType(node, "MemberExpression") &&
        (getStaticPropertyName(node) === "constructor" ||
          getStaticPropertyName(node) === "__proto__")) ||
      (isNodeOfType(node, "Property") &&
        isNodeOfType(node.parent, "ObjectPattern") &&
        (getStaticKeyName(node.key) === "constructor" ||
          getStaticKeyName(node.key) === "__proto__")) ||
      STRING_PROP_PROVIDER_HAZARD_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }

    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === declaration.source.value &&
      !isTypeOnlyImport(node)
    ) {
      for (const importedSpecifier of node.specifiers) {
        const isNamedForwardRef =
          isNodeOfType(importedSpecifier, "ImportSpecifier") &&
          importedSpecifier.importKind !== "type" &&
          getImportedName(importedSpecifier) === "forwardRef";
        const isNamespaceProvider =
          isNodeOfType(importedSpecifier, "ImportDefaultSpecifier") ||
          isNodeOfType(importedSpecifier, "ImportNamespaceSpecifier") ||
          (isNodeOfType(importedSpecifier, "ImportSpecifier") &&
            importedSpecifier.importKind !== "type" &&
            getImportedName(importedSpecifier) === "default");
        if (!isNamedForwardRef && !isNamespaceProvider) continue;
        const importedSymbol = scopes.symbolFor(importedSpecifier.local);
        if (!importedSymbol) {
          hasUnsupportedRuntime = true;
          return false;
        }
        for (const reference of importedSymbol.references) {
          if (isTypeScriptTypePosition(reference.identifier)) continue;
          let referenceRoot: EsTreeNode = reference.identifier;
          while (
            isNodeOfType(referenceRoot.parent, "MemberExpression") &&
            !referenceRoot.parent.computed &&
            !referenceRoot.parent.optional &&
            referenceRoot.parent.object === referenceRoot
          ) {
            referenceRoot = referenceRoot.parent;
          }
          if (
            isNodeOfType(referenceRoot.parent, "TSInterfaceHeritage") &&
            referenceRoot.parent.expression === referenceRoot &&
            isTypeScriptTypePosition(referenceRoot)
          )
            continue;
          const parent = reference.identifier.parent;
          if (
            reference.flag !== "read" ||
            isWithinAssignmentTarget(reference.identifier) ||
            (isNamedForwardRef &&
              (!isNodeOfType(parent, "CallExpression") ||
                parent.callee !== reference.identifier)) ||
            (isNamespaceProvider &&
              (!isNodeOfType(parent, "MemberExpression") ||
                parent.object !== reference.identifier ||
                parent.computed ||
                !isNodeOfType(parent.parent, "CallExpression") ||
                parent.parent.callee !== parent))
          ) {
            hasUnsupportedRuntime = true;
            return false;
          }
        }
      }
    }
    return undefined;
  });
  return !hasUnsupportedRuntime;
};
