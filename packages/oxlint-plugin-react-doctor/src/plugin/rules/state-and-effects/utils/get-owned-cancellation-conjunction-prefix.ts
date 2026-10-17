import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { isEffectLocalCancellationGuard } from "../../../utils/is-effect-local-cancellation-guard.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const PROGRAM_SUPPORT = new WeakMap<EsTreeNode, boolean>();
const ERASED_TYPES = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSTypeAnnotation",
]);
const RUNTIME_TYPES = new Set([
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSParameterProperty",
]);
const EXPRESSION_WRAPPERS = new Set([
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);
const READABLE_BINDING_KINDS = new Set([
  "const",
  "let",
  "var",
  "parameter",
  "catch-clause-parameter",
]);

const hasSupportedCancellationProgram = (expression: EsTreeNode, context: RuleContext): boolean => {
  const program = findProgramRoot(expression);
  if (!program) return false;
  const previous = PROGRAM_SUPPORT.get(program);
  if (previous !== undefined) return previous;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    const referenceSymbol = isNodeOfType(node, "Identifier")
      ? context.scopes.referenceFor(node)?.resolvedSymbol
      : null;
    if (
      ("declare" in node && node.declare === true) ||
      referenceSymbol?.kind === "ts-interface" ||
      referenceSymbol?.kind === "ts-type-alias" ||
      RUNTIME_TYPES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval")
    ) {
      supported = false;
      return false;
    }
    if (ERASED_TYPES.has(node.type) || isTypeScriptTypePosition(node)) return false;
    if (node.type.startsWith("TS") && !EXPRESSION_WRAPPERS.has(node.type)) {
      supported = false;
      return false;
    }
    return undefined;
  });
  PROGRAM_SUPPORT.set(program, supported);
  return supported;
};

const isReadonlyCancellationTailIdentifier = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression);
  return Boolean(
    symbol &&
    READABLE_BINDING_KINDS.has(symbol.kind) &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ),
  );
};

const isCancellationTailAtom = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  if (isReadonlyCancellationTailIdentifier(candidate, context)) return true;
  if (isNodeOfType(candidate, "Literal")) {
    if (
      ("regex" in candidate && candidate.regex != null) ||
      ("bigint" in candidate && candidate.bigint != null)
    )
      return false;
    return (
      typeof candidate.value === "string" ||
      typeof candidate.value === "number" ||
      typeof candidate.value === "boolean" ||
      (candidate.value === null && candidate.raw === "null")
    );
  }
  return (
    isNodeOfType(candidate, "UnaryExpression") &&
    candidate.operator === "typeof" &&
    isReadonlyCancellationTailIdentifier(stripParenExpression(candidate.argument), context)
  );
};

const isPureCancellationTail = (expression: EsTreeNode, context: RuleContext): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    isCancellationTailAtom(candidate, context) ||
    (isNodeOfType(candidate, "BinaryExpression") &&
      (candidate.operator === "===" || candidate.operator === "!==") &&
      isCancellationTailAtom(candidate.left, context) &&
      isCancellationTailAtom(candidate.right, context))
  );
};

export const getOwnedCancellationConjunctionPrefix = (
  expression: EsTreeNode,
  effectCallback: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "LogicalExpression") ||
    candidate.operator !== "&&" ||
    !hasSupportedCancellationProgram(candidate, context)
  )
    return null;
  let supportedGuard = true;
  walkAst(candidate, (node) => {
    if (
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression")
    )
      supportedGuard = false;
    return supportedGuard ? undefined : false;
  });
  if (!supportedGuard) return null;
  while (isNodeOfType(candidate, "LogicalExpression")) {
    if (candidate.operator !== "&&" || !isPureCancellationTail(candidate.right, context))
      return null;
    candidate = stripParenExpression(candidate.left);
  }
  return isEffectLocalCancellationGuard(candidate, effectCallback, context) ? candidate : null;
};
