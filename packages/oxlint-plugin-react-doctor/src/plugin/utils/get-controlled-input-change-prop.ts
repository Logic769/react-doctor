import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getImportedName } from "./get-imported-name.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasUnsupportedKeyedDraftRuntime } from "./has-unsupported-keyed-draft-runtime.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import type { RuleContext } from "./rule-context.js";
import { someAst } from "./some-ast.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isReadOnlyControlImport = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  hasCompleteSymbolReferences(symbol, program, scopes) &&
  symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    let expression = reference.identifier;
    while (
      (isNodeOfType(expression.parent, "MemberExpression") ||
        isNodeOfType(expression.parent, "JSXMemberExpression")) &&
      expression.parent.object === expression
    ) {
      if (
        isNodeOfType(expression.parent, "MemberExpression") &&
        (expression.parent.computed || expression.parent.optional)
      )
        return false;
      expression = expression.parent;
    }
    const parent = expression.parent;
    if (
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === expression
    )
      return true;
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== expression ||
      !isNodeOfType(parent.parent, "VariableDeclaration") ||
      parent.parent.kind !== "const" ||
      !isNodeOfType(parent.id, "Identifier")
    )
      return false;
    const alias = scopes.symbolFor(parent.id);
    return Boolean(
      alias &&
      hasCompleteSymbolReferences(alias, program, scopes) &&
      alias.references.every((aliasReference) => {
        const aliasParent = aliasReference.identifier.parent;
        return (
          aliasReference.flag === "read" &&
          ((isNodeOfType(aliasParent, "ExportSpecifier") &&
            aliasParent.local === aliasReference.identifier) ||
            (isNodeOfType(aliasParent, "JSXOpeningElement") &&
              aliasParent.name === aliasReference.identifier) ||
            (isNodeOfType(aliasParent, "JSXClosingElement") &&
              aliasParent.name === aliasReference.identifier))
        );
      }),
    );
  });

const getPrimitiveChangeProp = (
  expression: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (
    isNodeOfType(expression, "JSXIdentifier") &&
    (expression.name === "input" || expression.name === "textarea")
  )
    return "onChange";
  let root = expression;
  let member: string | null = null;
  if (isNodeOfType(expression, "MemberExpression")) {
    if (expression.computed || expression.optional) return null;
    member = getStaticPropertyName(expression);
    root = expression.object;
  } else if (isNodeOfType(expression, "JSXMemberExpression")) {
    member = expression.property.name;
    root = expression.object;
  }
  const symbol = scopes.symbolFor(root);
  const imported = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !imported ||
    imported.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    !isReadOnlyControlImport(symbol, program, scopes)
  )
    return null;
  const importedName = getImportedName(symbol.declarationNode);
  if (imported.source.value === "@base-ui/react/input" && importedName === "Input" && !member)
    return "onChange";
  if (
    imported.source.value === "@base-ui/react/select" &&
    importedName === "Select" &&
    member === "Root"
  )
    return "onValueChange";
  return null;
};

const getForwardedChangeProp = (
  expression: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const direct = getPrimitiveChangeProp(expression, program, scopes);
  if (direct) return direct;
  if (
    (!isNodeOfType(expression, "FunctionDeclaration") &&
      !isNodeOfType(expression, "ArrowFunctionExpression")) ||
    expression.async ||
    expression.generator ||
    expression.typeParameters ||
    expression.params.length !== 1 ||
    !isNodeOfType(expression.params[0], "ObjectPattern")
  )
    return null;
  const bindings = getFunctionBindingSymbols(expression, scopes);
  if (
    bindings.length !== 1 ||
    !bindings.every(
      (binding) =>
        hasCompleteSymbolReferences(binding, program, scopes) &&
        binding.references.every((reference) => {
          if (isTypeScriptTypePosition(reference.identifier)) return true;
          const parent = reference.identifier.parent;
          return (
            reference.flag === "read" &&
            ((isNodeOfType(parent, "ExportSpecifier") && parent.local === reference.identifier) ||
              ((isNodeOfType(parent, "JSXOpeningElement") ||
                isNodeOfType(parent, "JSXClosingElement")) &&
                parent.name === reference.identifier))
          );
        }),
    )
  )
    return null;
  const parameter = expression.params[0];
  const rest = parameter.properties.at(-1);
  if (!isNodeOfType(rest, "RestElement") || !isNodeOfType(rest.argument, "Identifier")) return null;
  if (
    parameter.properties
      .slice(0, -1)
      .some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.computed ||
          !isNodeOfType(property.key, "Identifier") ||
          property.key.name === "value" ||
          property.key.name === "onChange" ||
          property.key.name === "onValueChange" ||
          !isNodeOfType(property.value, "Identifier"),
      )
  )
    return null;
  const returnedExpression = getSingleReturnExpression(expression);
  const returned = returnedExpression ? stripParenExpression(returnedExpression) : null;
  if (!isNodeOfType(returned, "JSXElement")) return null;
  const opening = returned.openingElement;
  const changeProp = getPrimitiveChangeProp(opening.name, program, scopes);
  if (!changeProp) return null;
  const spread = opening.attributes.at(-1);
  const restSymbol = scopes.symbolFor(rest.argument);
  if (
    !restSymbol ||
    !isNodeOfType(spread, "JSXSpreadAttribute") ||
    scopes.symbolFor(spread.argument) !== restSymbol ||
    !hasCompleteSymbolReferences(restSymbol, program, scopes) ||
    restSymbol.references.length !== 1 ||
    restSymbol.references[0]?.identifier !== spread.argument ||
    restSymbol.references[0]?.flag !== "read"
  )
    return null;
  if (
    opening.attributes.slice(0, -1).some((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return true;
      const name = getJsxAttributeName(attribute.name);
      if (
        ["value", "onChange", "onValueChange", "render", "readOnly", "disabled", "hidden"].includes(
          name ?? "",
        )
      )
        return true;
      if (name !== "type") return false;
      if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
      const value = attribute.value.expression;
      return (
        !isNodeOfType(value, "Identifier") ||
        !parameter.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            !property.computed &&
            isNodeOfType(property.key, "Identifier") &&
            property.key.name === "type" &&
            isNodeOfType(property.value, "Identifier") &&
            scopes.symbolFor(property.value) === scopes.symbolFor(value),
        )
      );
    })
  )
    return null;
  return changeProp;
};

export const getControlledInputChangeProp = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): string | null => {
  if (
    opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        ["render", "readOnly", "disabled", "hidden", "type"].includes(
          getJsxAttributeName(attribute.name) ?? "",
        ),
    )
  )
    return null;
  const program = findProgramRoot(opening);
  if (!program) return null;
  const direct = getPrimitiveChangeProp(opening.name, program, context.scopes);
  if (direct) return direct;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return null;
  const symbol = context.scopes.symbolFor(opening.name);
  if (!symbol || !hasCompleteSymbolReferences(symbol, program, context.scopes)) return null;
  if (
    symbol.references.some((reference) => {
      const parent = reference.identifier.parent;
      return (
        reference.flag !== "read" ||
        !(
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === reference.identifier
        )
      );
    })
  )
    return null;
  let expression = symbol.initializer;
  let providerProgram: EsTreeNode = program;
  let providerScopes = context.scopes;
  const imported = getImportDeclarationForSymbol(symbol);
  if (imported) {
    const name = getImportedName(symbol.declarationNode);
    if (
      !name ||
      imported.importKind === "type" ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type")
    )
      return null;
    if (!context.filename) return null;
    const resolved = resolveCrossFileValueExportWithFilePath(
      context.filename,
      imported.source.value,
      name,
    );
    if (!resolved) return null;
    expression = resolved.exportedNode;
    providerProgram = resolved.programNode;
    providerScopes = analyzeScopes(providerProgram);
  }
  if (
    !expression ||
    hasUnsupportedKeyedDraftRuntime(providerProgram) ||
    someAst(
      providerProgram,
      (node) =>
        isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "defaultProps",
    )
  )
    return null;
  return getForwardedChangeProp(expression, providerProgram, providerScopes);
};
