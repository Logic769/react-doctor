import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";

export const isReadonlyCallbackMapSymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");
