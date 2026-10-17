import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";

export const isErasedTypeScriptBinding = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") return true;
  if (symbol.kind === "import") return getValueImportDeclaration(symbol) === null;
  if (
    symbol.kind === "ts-import-equals" &&
    "importKind" in symbol.declarationNode &&
    symbol.declarationNode.importKind === "type"
  )
    return true;
  let declaration = symbol.declarationNode;
  while (declaration.parent) {
    if ("declare" in declaration && declaration.declare === true) return true;
    declaration = declaration.parent;
  }
  return false;
};
