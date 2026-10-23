import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";

export const hasSymbolBindingWrites = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
  );
