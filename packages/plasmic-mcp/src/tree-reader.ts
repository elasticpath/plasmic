/**
 * Custom Tpl model tree reader.
 *
 * Walks the in-memory Tpl tree directly to produce full-fidelity JSON output.
 * Does NOT use the degraded tplToPlasmicElements() function (which is an SDUI
 * MVP that drops styles, images, and layout types).
 *
 * For each node type:
 *   TplTag      → HTML tag, CSS styles, text content, image sources, children
 *   TplComponent → referenced component name/UUID, props
 *   TplSlot     → slot name, default contents
 *
 * Reads from the base variant's VariantSetting (vsettings[0]).
 * Mixin-inherited styles are not resolved (MVP limitation).
 *
 * M3 additions:
 *   readComponentSummary() — compact outline (type, tag, name, uuid, childCount)
 *   readNodeDetails()      — full details for a single node + children as summaries
 *   TreeReadOptions        — maxDepth, excludeStyles, summaryOnly support
 *
 * Reference: platform/wab/src/wab/shared/element-repr/gen-element-repr-v2.ts
 */

import {
  isKnownTplTag,
  isKnownTplComponent,
  isKnownTplSlot,
  isKnownRawText,
  isKnownExprText,
  isKnownCustomCode,
  isKnownRenderExpr,
  isKnownVarRef,
  isKnownImageAssetRef,
  isKnownStyleTokenRef,
} from "@/wab/shared/model/classes";
import type { TreeNode, TreeReadOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a component's full Tpl tree with optional filtering.
 * Backward compatible — calling with no options produces the same output as before.
 */
export function readComponentTree(
  component: any,
  options?: TreeReadOptions
): TreeNode | null {
  const tplTree = component.tplTree;
  if (!tplTree) return null;
  return readTplNode(tplTree, options, 0);
}

/**
 * Compact outline of a component's tree: type, tag, name, uuid, childCount
 * per node. No styles, attrs, or text. Target ~2KB for a 50-node component.
 */
export function readComponentSummary(
  component: any,
  maxDepth?: number
): TreeNode | null {
  return readComponentTree(component, { summaryOnly: true, maxDepth });
}

/**
 * Full details for a single TplNode with immediate children as summaries.
 * Used by the get-node-details tool after node-resolver has located the node.
 * Target ~300B per call.
 */
export function readNodeDetails(tplNode: any): TreeNode {
  // Read just this node's full details (no children recursion)
  const node = readTplNode(tplNode, { maxDepth: 0 }, 0);
  if (!node) {
    return { type: "tag", tag: "div" };
  }

  // Get raw Tpl children and produce summary for each
  const rawChildren = getTplChildren(tplNode);
  node.childCount = rawChildren.length;

  if (rawChildren.length > 0) {
    const summaryChildren = rawChildren
      .map((child: any) =>
        readTplNode(child, { summaryOnly: true, maxDepth: 0 }, 0)
      )
      .filter(Boolean) as TreeNode[];
    if (summaryChildren.length > 0) {
      node.children = summaryChildren;
    }
  }

  return node;
}

/**
 * Count total nodes in a TreeNode tree.
 */
export function countTreeNodes(node: TreeNode | null): number {
  if (!node) return 0;
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countTreeNodes(child);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Internal: Tpl node reading
// ---------------------------------------------------------------------------

function readTplNode(
  tpl: any,
  options: TreeReadOptions | undefined,
  depth: number
): TreeNode | null {
  if (isKnownTplTag(tpl)) {
    return readTplTag(tpl, options, depth);
  }
  if (isKnownTplComponent(tpl)) {
    return readTplComponent(tpl, options);
  }
  if (isKnownTplSlot(tpl)) {
    return readTplSlot(tpl, options, depth);
  }
  return {
    type: "tag",
    tag: "div",
    name: `Unknown(${tpl?.constructor?.name ?? "?"})`,
    childCount: 0,
  };
}

function readTplTag(
  tpl: any,
  options: TreeReadOptions | undefined,
  depth: number
): TreeNode {
  const vs = tpl.vsettings?.[0]; // Base variant setting
  const rs = vs?.rs;

  const node: TreeNode = {
    type: "tag",
    tag: tpl.tag ?? "div",
    uuid: tpl.uuid,
  };

  if (tpl.type && tpl.type !== "other") {
    node.nodeType = tpl.type;
  }

  if (tpl.name) {
    node.name = tpl.name;
  }

  // In summary mode, skip styles, text, and attrs
  if (!options?.summaryOnly) {
    // CSS styles from the base variant's RuleSet
    if (
      !options?.excludeStyles &&
      rs?.values &&
      typeof rs.values === "object"
    ) {
      const values = { ...rs.values };
      if (Object.keys(values).length > 0) {
        node.styles = values;
      }
    }

    // Derive layout type from flex styles
    if (node.styles) {
      node.layoutType = deriveLayoutType(node.styles);
    }

    // Text content (for text blocks)
    if (vs?.text) {
      const text = extractText(vs.text);
      if (text !== undefined) {
        node.text = text;
      }
    }

    // HTML attributes
    if (vs?.attrs && typeof vs.attrs === "object") {
      const attrs = extractAttrs(vs.attrs);
      if (Object.keys(attrs).length > 0) {
        node.attrs = attrs;
      }
    }
  }

  // Children
  const rawChildren = tpl.children ?? [];
  const shouldRecurse =
    options?.maxDepth === undefined || depth < options.maxDepth;

  if (rawChildren.length > 0) {
    if (shouldRecurse) {
      const children = rawChildren
        .map((child: any) => readTplNode(child, options, depth + 1))
        .filter(Boolean) as TreeNode[];
      if (children.length > 0) {
        node.children = children;
      }
    }
    // Set childCount when depth-truncated or in summary mode
    if (!shouldRecurse || options?.summaryOnly) {
      node.childCount = rawChildren.length;
    }
  } else if (options?.summaryOnly) {
    node.childCount = 0;
  }

  return node;
}

function readTplComponent(
  tpl: any,
  options: TreeReadOptions | undefined
): TreeNode {
  const node: TreeNode = {
    type: "component",
    uuid: tpl.uuid,
    componentName: tpl.component?.name ?? "Unknown",
    componentUuid: tpl.component?.uuid,
  };

  if (tpl.name) {
    node.name = tpl.name;
  }

  // In summary mode, include childCount and skip props
  if (options?.summaryOnly) {
    node.childCount = 0;
    return node;
  }

  // Extract component args/props from the base variant
  const vs = tpl.vsettings?.[0];
  if (vs?.args?.length > 0) {
    const props: Record<string, unknown> = {};
    for (const arg of vs.args) {
      const paramName = arg.param?.variable?.name;
      if (!paramName) continue;

      const value = extractExprValue(arg.expr);
      if (value !== undefined) {
        props[paramName] = value;
      }
    }
    if (Object.keys(props).length > 0) {
      node.attrs = props;
    }
  }

  return node;
}

function readTplSlot(
  tpl: any,
  options: TreeReadOptions | undefined,
  depth: number
): TreeNode {
  const node: TreeNode = {
    type: "slot",
    uuid: tpl.uuid,
    slotName: tpl.param?.variable?.name ?? "unnamed",
  };

  const rawChildren = tpl.defaultContents ?? [];
  const shouldRecurse =
    options?.maxDepth === undefined || depth < options.maxDepth;

  if (rawChildren.length > 0) {
    if (shouldRecurse) {
      const children = rawChildren
        .map((child: any) => readTplNode(child, options, depth + 1))
        .filter(Boolean) as TreeNode[];
      if (children.length > 0) {
        node.children = children;
      }
    }
    if (!shouldRecurse || options?.summaryOnly) {
      node.childCount = rawChildren.length;
    }
  } else if (options?.summaryOnly) {
    node.childCount = 0;
  }

  return node;
}

// ---------------------------------------------------------------------------
// Internal: Tpl child extraction (for readNodeDetails)
// ---------------------------------------------------------------------------

function getTplChildren(tpl: any): any[] {
  if (isKnownTplTag(tpl)) {
    return tpl.children ?? [];
  }
  if (isKnownTplSlot(tpl)) {
    return tpl.defaultContents ?? [];
  }
  // TplComponent: don't traverse into component instances
  return [];
}

// ---------------------------------------------------------------------------
// Internal: Style and expression helpers
// ---------------------------------------------------------------------------

function deriveLayoutType(
  styles: Record<string, string>
): "vbox" | "hbox" | "box" {
  const flexDirection = styles["flexDirection"] || styles["flex-direction"];
  if (flexDirection === "column") return "vbox";
  if (flexDirection === "row") return "hbox";

  const display = styles["display"];
  if (display === "flex" || display === "inline-flex") {
    return "hbox"; // Default flex direction is row
  }

  return "box";
}

function extractText(richText: any): string | undefined {
  if (isKnownRawText(richText)) {
    return richText.text;
  }
  if (isKnownExprText(richText)) {
    return richText.html ?? "[dynamic text]";
  }
  return undefined;
}

function extractAttrs(attrs: Record<string, any>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(attrs)) {
    const value = extractExprValue(expr);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function extractExprValue(expr: any): unknown {
  if (!expr) return undefined;

  if (isKnownCustomCode(expr)) {
    try {
      return JSON.parse(expr.code);
    } catch {
      return expr.code;
    }
  }

  if (isKnownRawText(expr)) {
    return expr.text;
  }

  if (isKnownImageAssetRef(expr)) {
    return expr.asset?.dataUri ?? expr.asset?.url ?? "[image]";
  }

  if (isKnownStyleTokenRef(expr)) {
    return expr.token?.value ?? "[token]";
  }

  if (isKnownRenderExpr(expr)) {
    if (expr.tpl?.length > 0) {
      return expr.tpl
        .map((child: any) => readTplNode(child, undefined, 0))
        .filter(Boolean);
    }
    return undefined;
  }

  if (isKnownVarRef(expr)) {
    return `$${expr.variable?.name ?? "var"}`;
  }

  return undefined;
}
