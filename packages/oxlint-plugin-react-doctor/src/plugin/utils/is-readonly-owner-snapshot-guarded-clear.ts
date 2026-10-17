import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";
import {
  CALLBACK_HOOK_ARGUMENT_COUNT,
  DIRECT_HOOK_ARGUMENT_COUNT,
  OWNER_STATE_TUPLE_LENGTH,
  OWNER_RENDER_REFRESH_COUNT,
  REACT_OWNER_API_NAMES,
  SINGLE_EXIT_STATEMENT_COUNT,
  UNSUPPORTED_OWNER_GLOBAL_NAMES,
  UNSUPPORTED_OWNER_PROGRAM_NODE_TYPES,
  UNSUPPORTED_OWNER_PROPERTY_NAMES,
  UNSUPPORTED_OWNER_REGION_NODE_TYPES,
  UNSUPPORTED_OWNER_WINDOW_NODE_TYPES,
} from "./readonly-owner-snapshot/constants.js";

interface OwnerSnapshot {
  input: SymbolDescriptor;
  aliases: SymbolDescriptor[];
}

interface OwnerGuard {
  comparison: EsTreeNodeOfType<"BinaryExpression">;
  exitBranch: EsTreeNode | null;
}

const isPlainNullLiteral = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return (
    isNodeOfType(expression, "Literal") &&
    expression.value === null &&
    !("regex" in expression && expression.regex != null) &&
    !("bigint" in expression && expression.bigint != null)
  );
};

const isReadonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const isDirectCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.callee === node &&
  !node.parent.optional;

const isActualOwnerHook = (call: EsTreeNode, apiName: string, context: RuleContext): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isReactApiCall(call, apiName, context.scopes)
  )
    return false;
  const callee = call.callee;
  let provider: EsTreeNode | null = null;
  if (isNodeOfType(callee, "Identifier")) provider = callee;
  else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    isNodeOfType(callee.object, "Identifier")
  )
    provider = callee.object;
  const symbol = provider ? context.scopes.symbolFor(provider) : null;
  return Boolean(symbol && getValueImportSource(symbol) === "react" && isReadonlySymbol(symbol));
};

const getOwnerSnapshot = (
  node: EsTreeNode,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): OwnerSnapshot | null => {
  const aliases: SymbolDescriptor[] = [];
  const seen = new Set<SymbolDescriptor>();
  let current: EsTreeNode = stripParenExpression(node);
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol || !isReadonlySymbol(symbol) || seen.has(symbol)) return null;
    seen.add(symbol);
    if (symbol.kind === "parameter") {
      return aliases.length > 0 &&
        isFunctionLike(owner) &&
        owner.params.some((parameter) => parameter === symbol.bindingIdentifier)
        ? { input: symbol, aliases }
        : null;
    }
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      findEnclosingFunction(symbol.declarationNode) !== callback ||
      symbol.declarationNode.range[1] > firstSuspensionStart ||
      symbol.declarationNode.range[1] > current.range[0] ||
      !isNodeOnUnconditionalPath(symbol.declarationNode, callback)
    )
      return null;
    aliases.push(symbol);
    current = stripParenExpression(initializer);
  }
  return null;
};

const comparisonUsesRefAndInput = (
  comparison: EsTreeNode,
  ref: SymbolDescriptor,
  input: SymbolDescriptor,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(comparison, "BinaryExpression") ||
    (comparison.operator !== "===" && comparison.operator !== "!==")
  )
    return false;
  return [comparison.left, comparison.right].some((side) => {
    const member = stripParenExpression(side);
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.optional ||
      getStaticPropertyName(member) !== "current" ||
      !isNodeOfType(member.object, "Identifier") ||
      context.scopes.symbolFor(member.object) !== ref
    )
      return false;
    const counterpart = side === comparison.left ? comparison.right : comparison.left;
    const direct = stripParenExpression(counterpart);
    return (
      (isNodeOfType(direct, "Identifier") && context.scopes.symbolFor(direct) === input) ||
      getOwnerSnapshot(counterpart, callback, owner, firstSuspensionStart, context)?.input === input
    );
  });
};

const hasClosedOwnerRef = (
  ref: SymbolDescriptor,
  snapshot: OwnerSnapshot,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): boolean => {
  const initializer = getDirectConstInitializer(ref);
  if (
    !initializer ||
    !isActualOwnerHook(initializer, "useRef", context) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT ||
    findEnclosingFunction(ref.declarationNode) !== owner ||
    !isNodeOnUnconditionalPath(ref.declarationNode, owner) ||
    ref.declarationNode.range[1] > callback.range[0]
  )
    return false;
  const initialInput = initializer.arguments[0];
  if (
    !isNodeOfType(initialInput, "Identifier") ||
    context.scopes.symbolFor(initialInput) !== snapshot.input ||
    !isReadonlySymbol(ref)
  )
    return false;
  let refreshCount = 0;
  for (const reference of ref.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.optional ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    const expression = findTransparentExpressionRoot(member);
    const parent = expression.parent;
    if (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) {
      if (
        parent.operator !== "=" ||
        !isNodeOfType(parent.right, "Identifier") ||
        context.scopes.symbolFor(parent.right) !== snapshot.input ||
        findEnclosingFunction(parent) !== owner ||
        !isNodeOnUnconditionalPath(parent, owner) ||
        parent.range[0] < ref.declarationNode.range[1] ||
        parent.range[1] > callback.range[0]
      )
        return false;
      refreshCount++;
    } else if (
      !parent ||
      !comparisonUsesRefAndInput(
        parent,
        ref,
        snapshot.input,
        callback,
        owner,
        firstSuspensionStart,
        context,
      )
    )
      return false;
  }
  return refreshCount === OWNER_RENDER_REFRESH_COUNT;
};

const hasSupportedOwnerProgram = (names: ReadonlySet<string>, context: RuleContext): boolean => {
  let supported = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (
      UNSUPPORTED_OWNER_PROGRAM_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration")) &&
      names.has(node.id.name)
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind === "type") {
      if (node.specifiers.some((specifier) => names.has(specifier.local.name))) supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "ImportSpecifier") &&
      node.importKind === "type" &&
      names.has(node.local.name)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") &&
        node.exportKind === "type" &&
        !node.declaration) ||
      (isNodeOfType(node, "ExportAllDeclaration") && node.exportKind === "type") ||
      (isNodeOfType(node, "ExportSpecifier") && node.exportKind === "type")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, context.scopes);
      if (property === null || UNSUPPORTED_OWNER_PROPERTY_NAMES.has(property)) {
        supported = false;
        return false;
      }
    }
    if (
      (isNodeOfType(node, "Property") || isNodeOfType(node, "MethodDefinition")) &&
      (node.kind === "get" || node.kind === "set")
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) return;
    const symbol = reference.resolvedSymbol;
    if (
      UNSUPPORTED_OWNER_GLOBAL_NAMES.has(node.name) ||
      symbol?.kind === "ts-interface" ||
      symbol?.kind === "ts-type-alias" ||
      (symbol?.kind === "import" && getValueImportSource(symbol) === null)
    )
      supported = false;
  });
  if (!supported) return false;
  return context.scopes.rootScope.symbols.every((symbol) => {
    if (getValueImportSource(symbol) !== "react") return true;
    const named =
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) !== "default";
    return symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      if (named) return isDirectCall(reference.identifier);
      const member = reference.identifier.parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.optional &&
        REACT_OWNER_API_NAMES.has(getStaticPropertyName(member) ?? "") &&
        isDirectCall(member)
      );
    });
  });
};

const hasClosedStateSetter = (
  setter: SymbolDescriptor,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declaration = setter.declarationNode;
  if (
    setter.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== OWNER_STATE_TUPLE_LENGTH ||
    declaration.id.elements[1] !== setter.bindingIdentifier ||
    !isNodeOfType(declaration.id.elements[0], "Identifier") ||
    findEnclosingFunction(declaration) !== owner ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isActualOwnerHook(declaration.init, "useState", context) ||
    declaration.init.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT
  )
    return false;
  const [initial] = declaration.init.arguments;
  if (!isPlainNullLiteral(initial)) return false;
  return setter.references.every((reference) => {
    const call = reference.identifier.parent;
    return (
      reference.flag === "read" &&
      isDirectCall(reference.identifier) &&
      isNodeOfType(call, "CallExpression") &&
      call.arguments.length === DIRECT_HOOK_ARGUMENT_COUNT &&
      !isNodeOfType(call.arguments[0], "SpreadElement") &&
      !isFunctionLike(stripParenExpression(call.arguments[0]))
    );
  });
};

const isSupportedCallbackCarrier = (
  callback: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !callback.async ||
    callback.generator ||
    callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    findEnclosingFunction(callback) !== owner
  )
    return false;
  const parent = callback.parent;
  if (isNodeOfType(parent, "VariableDeclarator")) {
    const binding = isNodeOfType(parent.id, "Identifier")
      ? context.scopes.symbolFor(parent.id)
      : null;
    return parent.init === callback && binding?.kind === "const" && isReadonlySymbol(binding);
  }
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.arguments[0] !== callback ||
    parent.arguments.length !== CALLBACK_HOOK_ARGUMENT_COUNT ||
    !isActualOwnerHook(parent, "useCallback", context) ||
    !isNodeOfType(parent.arguments[1], "ArrayExpression")
  )
    return false;
  if (
    !parent.arguments[1].elements.every((element) => {
      if (!isNodeOfType(element, "Identifier")) return false;
      const input = context.scopes.symbolFor(element);
      return (
        input?.kind === "parameter" &&
        isReadonlySymbol(input) &&
        isFunctionLike(owner) &&
        owner.params.some((parameter) => parameter === input.bindingIdentifier)
      );
    })
  )
    return false;
  const declaration = parent.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== parent ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const binding = context.scopes.symbolFor(declaration.id);
  return binding?.kind === "const" && isReadonlySymbol(binding);
};

const isDirectOwnerExit = (node: EsTreeNode, callback: EsTreeNode): boolean => {
  let statement = node;
  if (isNodeOfType(statement, "BlockStatement")) {
    if (statement.body.length !== SINGLE_EXIT_STATEMENT_COUNT) return false;
    statement = statement.body[0];
  }
  if (isNodeOfType(statement, "ReturnStatement"))
    return !statement.argument || isNodeOfType(statement.argument, "Literal");
  if (!isNodeOfType(statement, "ThrowStatement")) return false;
  let ancestor = statement.parent;
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "TryStatement") && (ancestor.handler || ancestor.finalizer))
      return false;
    ancestor = ancestor.parent;
  }
  return ancestor === callback;
};

const isUninterruptedOwnerWindow = (
  guard: OwnerGuard,
  call: EsTreeNode,
  callback: EsTreeNode,
): boolean => {
  let supported = true;
  walkOwnFunctionScope(callback, (node) => {
    if (!supported) return false;
    if (node === guard.exitBranch) return false;
    if (node.range[0] < guard.comparison.range[1] || node.range[0] >= call.range[0]) return;
    if (
      UNSUPPORTED_OWNER_WINDOW_NODE_TYPES.has(node.type) ||
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(node.type) ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    )
      supported = false;
  });
  return supported;
};

export const isReadonlyOwnerSnapshotGuardedClear = (
  call: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  owner: EsTreeNode,
  setter: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (
    call.optional ||
    call.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT ||
    !isPlainNullLiteral(call.arguments[0]) ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isSupportedCallbackCarrier(callback, owner, context) ||
    !hasClosedStateSetter(setter, owner, context)
  )
    return false;
  let firstSuspensionStart = Infinity;
  let lastSuspensionEnd = -Infinity;
  let supportedRegion = true;
  walkOwnFunctionScope(callback, (node) => {
    if (
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(node.type) ||
      (isNodeOfType(node, "TryStatement") && node.finalizer)
    )
      supportedRegion = false;
    if (isNodeOfType(node, "AwaitExpression") && node.range[0] < call.range[0]) {
      firstSuspensionStart = Math.min(firstSuspensionStart, node.range[0]);
      lastSuspensionEnd = Math.max(lastSuspensionEnd, node.range[1]);
    }
  });
  if (!supportedRegion || !Number.isFinite(firstSuspensionStart)) return false;
  const getGuard = (
    condition: EsTreeNode,
    equality: boolean,
    exitBranch: EsTreeNode | null,
  ): OwnerGuard | null => {
    let expression = stripParenExpression(condition);
    while (
      equality &&
      isNodeOfType(expression, "LogicalExpression") &&
      expression.operator === "&&"
    )
      expression = stripParenExpression(expression.left);
    if (
      !isNodeOfType(expression, "BinaryExpression") ||
      expression.operator !== (equality ? "===" : "!==") ||
      expression.range[0] < lastSuspensionEnd
    )
      return null;
    for (const side of [expression.left, expression.right]) {
      const member = stripParenExpression(side);
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.optional ||
        getStaticPropertyName(member) !== "current" ||
        !isNodeOfType(member.object, "Identifier")
      )
        continue;
      const ref = context.scopes.symbolFor(member.object);
      const snapshot = getOwnerSnapshot(
        side === expression.left ? expression.right : expression.left,
        callback,
        owner,
        firstSuspensionStart,
        context,
      );
      if (
        !ref ||
        !snapshot ||
        !hasClosedOwnerRef(ref, snapshot, callback, owner, firstSuspensionStart, context)
      )
        continue;
      const names = new Set([
        ref.name,
        snapshot.input.name,
        setter.name,
        ...snapshot.aliases.map((alias) => alias.name),
      ]);
      if (!hasSupportedOwnerProgram(names, context)) continue;
      const guard = { comparison: expression, exitBranch };
      if (isUninterruptedOwnerWindow(guard, call, callback)) return guard;
    }
    return null;
  };
  let current: EsTreeNode | null | undefined = call;
  while (current?.parent && current.parent !== callback) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "IfStatement") &&
      isAstDescendant(call, parent.consequent) &&
      getGuard(parent.test, true, null)
    )
      return true;
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (isAstDescendant(call, statement)) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          !statement.alternate &&
          isDirectOwnerExit(statement.consequent, callback) &&
          getGuard(statement.test, false, statement.consequent)
        )
          return true;
      }
    }
    if (
      isNodeOfType(parent, "TryStatement") ||
      isNodeOfType(parent, "CatchClause") ||
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(parent.type)
    )
      return false;
    current = parent;
  }
  return false;
};
