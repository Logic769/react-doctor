import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { REF_NOTIFICATION_EVENT_ANCESTOR_TAGS } from "./constants.js";
import { isRefNotificationNativeElement } from "./is-ref-notification-native-element.js";

export const isRefNotificationNativeEvent = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  const opening = attribute.parent;
  const element = opening?.parent;
  if (
    getJsxAttributeName(attribute.name) !== "onClick" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(element, "JSXElement") ||
    getAuthoritativeJsxAttribute(opening.attributes, "onClick") !== attribute ||
    findEnclosingFunction(attribute) !== component ||
    !isRefNotificationNativeElement(element, context.scopes, false)
  )
    return false;
  let cursor: EsTreeNode = element;
  while (cursor) {
    const root = findTransparentExpressionRoot(cursor);
    const parent = root.parent;
    if (isNodeOfType(parent, "ReturnStatement"))
      return parent.argument === root && isNodeReachableWithinFunction(attribute, context);
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === root)
    ) {
      if (
        isNodeOfType(parent, "JSXElement") &&
        (!isRefNotificationNativeElement(parent, context.scopes, true) ||
          REF_NOTIFICATION_EVENT_ANCESTOR_TAGS.has(resolveJsxElementType(parent.openingElement)))
      )
        return false;
      cursor = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === root) {
      cursor = parent;
      continue;
    }
    return false;
  }
  return false;
};
