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
import type { TreeNode } from "./types.js";

export function readComponentTree(component: any): TreeNode | null {
  const tplTree = component.tplTree;
  if (!tplTree) return null;
  return readTplNode(tplTree);
}

function readTplNode(tpl: any): TreeNode | null {
  if (isKnownTplTag(tpl)) {
    return readTplTag(tpl);
  }
  if (isKnownTplComponent(tpl)) {
    return readTplComponent(tpl);
  }
  if (isKnownTplSlot(tpl)) {
    return readTplSlot(tpl);
  }
  return {
    type: "tag",
    tag: "div",
    name: `Unknown(${tpl?.constructor?.name ?? "?"})`,
  };
}

function readTplTag(tpl: any): TreeNode {
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

  // CSS styles from the base variant's RuleSet
  if (rs?.values && typeof rs.values === "object") {
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

  // Child nodes
  if (tpl.children?.length > 0) {
    const children = tpl.children
      .map((child: any) => readTplNode(child))
      .filter(Boolean) as TreeNode[];
    if (children.length > 0) {
      node.children = children;
    }
  }

  return node;
}

function readTplComponent(tpl: any): TreeNode {
  const node: TreeNode = {
    type: "component",
    uuid: tpl.uuid,
    componentName: tpl.component?.name ?? "Unknown",
    componentUuid: tpl.component?.uuid,
  };

  if (tpl.name) {
    node.name = tpl.name;
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

function readTplSlot(tpl: any): TreeNode {
  const node: TreeNode = {
    type: "slot",
    uuid: tpl.uuid,
    slotName: tpl.param?.variable?.name ?? "unnamed",
  };

  if (tpl.defaultContents?.length > 0) {
    const children = tpl.defaultContents
      .map((child: any) => readTplNode(child))
      .filter(Boolean) as TreeNode[];
    if (children.length > 0) {
      node.children = children;
    }
  }

  return node;
}

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
        .map((child: any) => readTplNode(child))
        .filter(Boolean);
    }
    return undefined;
  }

  if (isKnownVarRef(expr)) {
    return `$${expr.variable?.name ?? "var"}`;
  }

  return undefined;
}
