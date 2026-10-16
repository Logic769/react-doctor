import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES, REGEX_RESULT_PROVIDER_NAMES } from "./constants.js";

export const hasClosedLiteralStarRegexProviders = (
  source: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const program = findProgramRoot(source);
  if (!program) return false;
  let isClosed = true;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (isNodeOfType(node, "TSParameterProperty")) {
      if (node.decorators.length > 0 || !isNodeOfType(node.parameter, "Identifier"))
        isClosed = false;
      return false;
    }
    if (
      (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.isGlobalReference(node))
    ) {
      isClosed = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier") && isProvenGlobalObjectReference(node, scopes)) {
      const reference = findTransparentExpressionRoot(node);
      const consumer = reference.parent;
      if (
        isNodeOfType(consumer, "UnaryExpression") &&
        consumer.operator === "typeof" &&
        consumer.argument === reference
      )
        return;
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== reference ||
        consumer.optional ||
        isWithinAssignmentTarget(node) ||
        getStaticPropertyName(consumer) === null ||
        REGEX_GLOBAL_EXPOSED_PROPERTY_NAMES.has(getStaticPropertyName(consumer) ?? "")
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "MemberExpression")) return;
    if (
      !REGEX_RESULT_PROVIDER_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    )
      return;
    const reference = findTransparentExpressionRoot(node);
    const consumer = reference.parent;
    if (
      !isNodeOfType(node, "Identifier") ||
      !scopes.isGlobalReference(node) ||
      isWithinAssignmentTarget(node) ||
      (!isNodeOfType(consumer, "CallExpression") && !isNodeOfType(consumer, "NewExpression")) ||
      consumer.callee !== reference ||
      (isNodeOfType(consumer, "CallExpression") && consumer.optional)
    )
      isClosed = false;
  });
  return isClosed;
};
