import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FETCH_ERROR_PAYLOAD_RESTRICTED_ANCESTOR_TYPES,
  FETCH_ERROR_PAYLOAD_RUNTIME_TYPESCRIPT_TYPES,
} from "./constants.js";

interface FetchErrorPayloadContinuationInput {
  consumption: EsTreeNode;
  responseBinding: EsTreeNodeOfType<"Identifier">;
  context: RuleContext;
}

export const isHandledFetchErrorPayloadContinuation = ({
  consumption,
  responseBinding,
  context,
}: FetchErrorPayloadContinuationInput): boolean => {
  if (
    !isNodeOfType(consumption, "CallExpression") ||
    consumption.optional ||
    consumption.arguments.length !== 0
  ) {
    return false;
  }
  const consumer = consumption.callee;
  if (
    !isNodeOfType(consumer, "MemberExpression") ||
    consumer.optional ||
    consumer.computed ||
    !isNodeOfType(consumer.property, "Identifier") ||
    consumer.property.name !== "json" ||
    !isNodeOfType(consumer.object, "Identifier")
  ) {
    return false;
  }
  const responseSymbol = context.scopes.symbolFor(responseBinding);
  if (
    !responseSymbol ||
    responseSymbol.kind !== "const" ||
    responseSymbol.bindingIdentifier !== responseBinding ||
    !isNodeOfType(responseSymbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(responseSymbol.declarationNode.init, "AwaitExpression") ||
    context.scopes.symbolFor(consumer.object)?.id !== responseSymbol.id
  ) {
    return false;
  }
  const awaited = consumption.parent;
  const declarator = awaited?.parent;
  const declaration = declarator?.parent;
  const block = declaration?.parent;
  if (
    !isNodeOfType(awaited, "AwaitExpression") ||
    awaited.argument !== consumption ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== awaited ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    declarator.id.properties.length !== 1 ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1 ||
    !isNodeOfType(block, "BlockStatement")
  ) {
    return false;
  }
  const property = declarator.id.properties[0];
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    getStaticPropertyKeyName(property) !== "error" ||
    !isNodeOfType(property.value, "Identifier")
  ) {
    return false;
  }
  const errorSymbol = context.scopes.symbolFor(property.value);
  if (
    !errorSymbol ||
    errorSymbol.kind !== "const" ||
    errorSymbol.bindingIdentifier !== property.value ||
    errorSymbol.declarationNode !== declarator
  ) {
    return false;
  }
  const owner = findEnclosingFunction(declaration);
  if (!owner || !isFunctionLike(owner) || !owner.async) return false;
  let ancestor: EsTreeNode | null | undefined = declaration.parent;
  while (ancestor && ancestor !== owner) {
    if (FETCH_ERROR_PAYLOAD_RESTRICTED_ANCESTOR_TYPES.has(ancestor.type)) return false;
    ancestor = ancestor.parent;
  }
  const statementIndex = block.body.findIndex((statement) => statement === declaration);
  const guard = block.body[statementIndex - 1];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "MemberExpression") ||
    guard.test.optional ||
    guard.test.computed ||
    !isNodeOfType(guard.test.property, "Identifier") ||
    guard.test.property.name !== "ok" ||
    !isNodeOfType(guard.test.object, "Identifier") ||
    context.scopes.symbolFor(guard.test.object)?.id !== responseSymbol.id
  ) {
    return false;
  }
  let successExit: EsTreeNode = guard.consequent;
  if (isNodeOfType(successExit, "BlockStatement")) {
    const lastStatement = successExit.body.at(-1);
    if (!lastStatement) return false;
    successExit = lastStatement;
  }
  if (
    !isNodeOfType(successExit, "ReturnStatement") ||
    findEnclosingFunction(successExit) !== owner
  ) {
    return false;
  }
  for (const reference of responseSymbol.references) {
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(reference.identifier) ||
      findEnclosingFunction(reference.identifier) !== owner
    ) {
      return false;
    }
    const member = reference.identifier.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      member.optional ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier")
    ) {
      return false;
    }
    if (member === guard.test) continue;
    const call = member.parent;
    if (
      member.property.name !== "json" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== member ||
      call.optional ||
      call.arguments.length !== 0
    ) {
      return false;
    }
  }
  let program: EsTreeNode = owner;
  while (program.parent) program = program.parent;
  let supportedProgram = true;
  const toastSymbolIds = new Set<number>();
  walkAst(program, (node) => {
    if (!supportedProgram) return false;
    if (
      node.type === "WithStatement" ||
      (FETCH_ERROR_PAYLOAD_RUNTIME_TYPESCRIPT_TYPES.has(node.type) &&
        !("declare" in node && node.declare === true))
    ) {
      supportedProgram = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      context.scopes.referenceFor(node)
    ) {
      const symbol = context.scopes.symbolFor(node);
      const importDeclaration = symbol?.declarationNode.parent;
      const isErasedBinding = Boolean(
        symbol &&
        (symbol.kind === "ts-interface" ||
          symbol.kind === "ts-type-alias" ||
          (symbol.kind === "import" &&
            isNodeOfType(importDeclaration, "ImportDeclaration") &&
            (isTypeOnlyImport(importDeclaration) ||
              (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
                symbol.declarationNode.importKind === "type")))),
      );
      if (context.scopes.isGlobalReference(node) || isErasedBinding) {
        supportedProgram = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.source.value !== "sonner") return;
    for (const specifier of node.specifiers) {
      let selectedToast = false;
      if (isNodeOfType(specifier, "ImportSpecifier")) {
        const importedName = getStaticKeyName(specifier.imported);
        selectedToast = importedName === "toast";
        if (!selectedToast && importedName !== "default") continue;
      }
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || symbol.bindingIdentifier !== specifier.local) {
        supportedProgram = false;
        return false;
      }
      const runtimeReferences = symbol.references.filter(
        (reference) => !isTypeScriptTypePosition(reference.identifier),
      );
      const typeOnly =
        isTypeOnlyImport(node) ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type");
      if (typeOnly || !selectedToast) {
        if (runtimeReferences.length > 0) {
          supportedProgram = false;
          return false;
        }
        continue;
      }
      toastSymbolIds.add(symbol.id);
      for (const reference of runtimeReferences) {
        if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) {
          supportedProgram = false;
          return false;
        }
        let callee: EsTreeNode = reference.identifier;
        const member = callee.parent;
        if (
          isNodeOfType(member, "MemberExpression") &&
          member.object === callee &&
          !member.optional &&
          !member.computed &&
          isNodeOfType(member.property, "Identifier")
        ) {
          callee = member;
        }
        const call = callee.parent;
        if (!isNodeOfType(call, "CallExpression") || call.callee !== callee || call.optional) {
          supportedProgram = false;
          return false;
        }
      }
    }
  });
  if (!supportedProgram) return false;
  const errorReferences = errorSymbol.references.filter(
    (reference) =>
      !isTypeScriptTypePosition(reference.identifier) &&
      !(reference.identifier === property.key && property.value === errorSymbol.bindingIdentifier),
  );
  const reportStatements = new Set<EsTreeNode>();
  const allReferencesAreReports =
    errorReferences.length > 0 &&
    errorReferences.every((reference) => {
      if (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(reference.identifier) ||
        findEnclosingFunction(reference.identifier) !== owner
      ) {
        return false;
      }
      const call = reference.identifier.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.arguments.length !== 1 ||
        call.arguments[0] !== reference.identifier ||
        !isNodeOfType(call.callee, "MemberExpression") ||
        call.callee.optional ||
        call.callee.computed ||
        !isNodeOfType(call.callee.property, "Identifier") ||
        call.callee.property.name !== "error" ||
        !isNodeOfType(call.callee.object, "Identifier")
      ) {
        return false;
      }
      const reporter = context.scopes.symbolFor(call.callee.object);
      const statement = call.parent;
      const isReportStatement = Boolean(
        reporter &&
        toastSymbolIds.has(reporter.id) &&
        isNodeOfType(statement, "ExpressionStatement") &&
        statement.parent === block &&
        block.body.findIndex((candidate) => candidate === statement) > statementIndex,
      );
      if (!isReportStatement || !statement) return false;
      reportStatements.add(statement);
      return true;
    });
  const nextStatements = block.body.slice(
    statementIndex + 1,
    statementIndex + 1 + reportStatements.size,
  );
  return (
    allReferencesAreReports &&
    reportStatements.size > 0 &&
    nextStatements.length === reportStatements.size &&
    nextStatements.every((statement) => reportStatements.has(statement))
  );
};
