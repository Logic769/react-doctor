import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isNitroRuntimeAppGetter = (symbol: SymbolDescriptor): boolean => {
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !declaration.init
  )
    return false;
  const propertyNames = new Set<string>();
  for (const property of declaration.id.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      propertyNames.has(property.key.name)
    )
      return false;
    propertyNames.add(property.key.name);
  }
  if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) !== "useNitroApp") return false;
  const initializer = stripParenExpression(declaration.init);
  if (!isNodeOfType(initializer, "AwaitExpression")) return false;
  const imported = stripParenExpression(initializer.argument);
  return (
    isNodeOfType(imported, "ImportExpression") &&
    imported.options == null &&
    imported.attributes == null &&
    (!("phase" in imported) || imported.phase == null) &&
    isNodeOfType(imported.source, "Literal") &&
    imported.source.value === "nitropack/runtime" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    )
  );
};
