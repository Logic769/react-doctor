import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";

const runtimeSymbolsByErasedBinding = new WeakMap<SymbolDescriptor, SymbolDescriptor | null>();

export const findRuntimeValueSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || !isErasedTypeScriptBinding(symbol)) return symbol;
  if (!hasRuntimeValueBinding(symbol)) return null;
  const cached = runtimeSymbolsByErasedBinding.get(symbol);
  if (cached !== undefined) return cached;
  let scope: ScopeDescriptor | null = symbol.scope;
  while (scope) {
    const candidates = scope.symbols.filter(
      (candidate) => candidate.name === symbol.name && !isErasedTypeScriptBinding(candidate),
    );
    if (candidates.length > 0) {
      const runtimeSymbol = candidates.length === 1 ? (candidates[0] ?? null) : null;
      runtimeSymbolsByErasedBinding.set(symbol, runtimeSymbol);
      return runtimeSymbol;
    }
    scope = scope.parent;
  }
  runtimeSymbolsByErasedBinding.set(symbol, null);
  return null;
};
