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
  isKnownObjectPath,
  isKnownRenderExpr,
  isKnownVarRef,
  isKnownImageAssetRef,
  isKnownStyleTokenRef,
  isKnownStyleMarker,
  isKnownNodeMarker,
} from "@/wab/shared/model/classes";
import type { TreeNode, TreeNodeMark, TreeReadOptions } from "./types.js";
import { isTokenRef, parseTokenRefUuid, resolveTokenValue } from "./token-reader.js";

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
  if (!tplTree) {return null;}
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
 *
 * When styleTokens are provided, var(--token-<uuid>) values in styles are
 * resolved to CSS values and annotated with token names in tokenRefs.
 */
export function readNodeDetails(tplNode: any, styleTokens?: any[]): TreeNode {
  // Read just this node's full details (no children recursion)
  const node = readTplNode(tplNode, { maxDepth: 0, styleTokens }, 0);
  if (!node) {
    return { type: "tag", tag: "div" };
  }

  // TplComponent: group slot override children by slot name
  if (isKnownTplComponent(tplNode)) {
    const vs = tplNode.vsettings?.[0];
    const slotArgs = (vs?.args ?? []).filter(
      (arg: any) => isKnownRenderExpr(arg.expr)
    );
    const totalOverrideNodes = slotArgs.reduce(
      (n: number, arg: any) => n + (arg.expr.tpl?.length ?? 0),
      0
    );
    node.childCount = totalOverrideNodes;

    if (slotArgs.length > 0) {
      const slotChildren = buildSlotChildren(
        slotArgs,
        { summaryOnly: true, maxDepth: 0 },
        0
      );
      if (slotChildren.length > 0) {
        node.children = slotChildren;
      }
    }
    return node;
  }

  // Default: TplTag, TplSlot — get raw children and produce summaries
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
 * Read a subtree starting from a specific TplNode with optional depth limiting.
 * Used by the get-subtree tool to return full tree from a specific node downward.
 * Combines node-resolver targeting with tree-reader output.
 */
export function readSubtree(
  tplNode: any,
  options?: TreeReadOptions
): TreeNode | null {
  return readTplNode(tplNode, options, 0);
}

/**
 * Count total nodes in a TreeNode tree.
 */
export function countTreeNodes(node: TreeNode | null): number {
  if (!node) {return 0;}
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countTreeNodes(child);
    }
  }
  return count;
}

/**
 * Count total nodes in the raw Tpl tree, independently of any maxDepth truncation.
 * Walks TplTag.children, TplComponent slot overrides (RenderExpr.tpl), and
 * TplSlot.defaultContents to produce an accurate total.
 */
export function countTplNodes(tpl: any): number {
  if (!tpl) {return 0;}
  let count = 1;

  if (isKnownTplTag(tpl)) {
    for (const child of tpl.children ?? []) {
      count += countTplNodes(child);
    }
  } else if (isKnownTplComponent(tpl)) {
    const vs = tpl.vsettings?.[0];
    if (vs?.args?.length > 0) {
      for (const arg of vs.args) {
        if (isKnownRenderExpr(arg.expr)) {
          for (const child of arg.expr.tpl ?? []) {
            count += countTplNodes(child);
          }
        }
      }
    }
  } else if (isKnownTplSlot(tpl)) {
    for (const child of tpl.defaultContents ?? []) {
      count += countTplNodes(child);
    }
  }

  return count;
}

/**
 * Truncate a TreeNode tree to fit within a character budget.
 *
 * Why: Even with maxDepth defaults, a wide component at depth 3 can produce
 * 15-20k tokens. This function is a hard safety net that prevents any single
 * inspect response from consuming excessive context window.
 *
 * Strategy (breadth-first priority — shallow nodes over deeper ones):
 * 1. Progressively reduce effective depth, removing deepest levels first
 * 2. If still over budget, truncate siblings (remove trailing children at root)
 *
 * Always produces valid JSON — prunes whole nodes, never cuts mid-object.
 */
export function truncateTreeToCharBudget(
  tree: TreeNode | null,
  maxChars: number
): { tree: TreeNode | null; nodesShown: number; wasTruncated: boolean } {
  if (!tree) return { tree: null, nodesShown: 0, wasTruncated: false };

  let json = JSON.stringify(tree);
  if (json.length <= maxChars) {
    return { tree, nodesShown: countTreeNodes(tree), wasTruncated: false };
  }

  // Deep clone to avoid mutating the original
  const pruned: TreeNode = JSON.parse(json);

  // Phase 1: Progressively reduce depth (breadth-first priority)
  // Stop at height 1 so Phase 2 can do fine-grained sibling truncation
  let height = getTreeHeight(pruned);
  while (height > 1) {
    height--;
    pruneTreeAtDepth(pruned, height, 0);
    json = JSON.stringify(pruned);
    if (json.length <= maxChars) break;
  }

  // Phase 2: Truncate trailing children at root level
  json = JSON.stringify(pruned);
  if (json.length > maxChars && pruned.children) {
    pruned.childCount = pruned.childCount ?? pruned.children.length;
    while (pruned.children.length > 0) {
      pruned.children.pop();
      json = JSON.stringify(pruned);
      if (json.length <= maxChars) break;
    }
    if (pruned.children.length === 0) {
      delete pruned.children;
    }
  }

  return {
    tree: pruned,
    nodesShown: countTreeNodes(pruned),
    wasTruncated: true,
  };
}

/**
 * Transform a TreeNode tree into concise format for orientation-only queries.
 *
 * Why: Full TreeNode output includes UUIDs (36 bytes each), verbose keys
 * (`childCount`, `componentName`, `componentUuid`), and detail fields
 * (`dataCond` expressions, `dataRep` objects) that are unnecessary when an
 * agent is just orienting within a component tree. Concise format strips
 * these, achieving ~70% token reduction for summary-style queries while
 * keeping enough info (tag, name, position) for the agent to identify nodes
 * and drill in with inspect.node using the node name.
 *
 * Root node always retains its UUID so subsequent tool calls can reference it.
 *
 * Key mappings:
 *   type          → dropped (inferred from tag/comp/slot presence)
 *   nodeType      → dropped
 *   uuid          → dropped (except root)
 *   childCount    → cc
 *   componentName → comp
 *   componentUuid → dropped
 *   slotName      → slot
 *   visibility    → hidden: true
 *   dataCond      → conditional: true
 *   dataRep       → repeats: true
 */
export function toConciseFormat(
  node: TreeNode,
  isRoot: boolean = true
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Identity — root keeps UUID for subsequent tool calls
  if (isRoot && node.uuid) result.uuid = node.uuid;
  if (node.tag) result.tag = node.tag;
  if (node.name) result.name = node.name;

  // Component → comp (replaces componentName + componentUuid)
  if (node.componentName) result.comp = node.componentName;

  // Slot → slot (replaces slotName)
  if (node.slotName) result.slot = node.slotName;

  // Layout
  if (node.layoutType) result.layoutType = node.layoutType;

  // Styles (kept when present — concise strips metadata, not content)
  if (node.styles) result.styles = node.styles;
  if (node.tokenRefs) result.tokenRefs = node.tokenRefs;

  // Text
  if (node.text) result.text = node.text;
  if (node.marks) result.marks = node.marks;
  if (node.dynamic) result.dynamic = node.dynamic;
  if (node.fallback) result.fallback = node.fallback;

  // Attrs
  if (node.attrs) result.attrs = node.attrs;

  // Boolean flags replace verbose detail fields
  if (node.visibility) result.hidden = true;
  if (node.dataCond) result.conditional = true;
  if (node.dataRep) result.repeats = true;

  // childCount → cc
  if (node.childCount !== undefined) result.cc = node.childCount;

  // Recurse children
  if (node.children) {
    result.children = node.children.map((child) =>
      toConciseFormat(child, false)
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal: Character budget helpers
// ---------------------------------------------------------------------------

/**
 * Get the height of a TreeNode tree (longest path from root to leaf).
 * Leaf node = 0, parent of leaves = 1, etc.
 */
function getTreeHeight(node: TreeNode): number {
  if (!node.children || node.children.length === 0) return 0;
  let max = 0;
  for (const child of node.children) {
    max = Math.max(max, getTreeHeight(child));
  }
  return max + 1;
}

/**
 * Remove children from all nodes at or beyond a given depth.
 * Nodes at the target depth get childCount set and children removed.
 */
function pruneTreeAtDepth(node: TreeNode, maxDepth: number, currentDepth: number): void {
  if (currentDepth >= maxDepth) {
    if (node.children && node.children.length > 0) {
      node.childCount = node.children.length;
      delete node.children;
    }
    return;
  }
  if (node.children) {
    for (const child of node.children) {
      pruneTreeAtDepth(child, maxDepth, currentDepth + 1);
    }
  }
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
    return readTplComponent(tpl, options, depth);
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

  // Visibility and data condition — structurally important, shown even in summary mode
  const visInfo = extractVisibilityInfo(vs, rs);
  if (visInfo.visibility) node.visibility = visInfo.visibility;
  if (visInfo.dataCond) node.dataCond = visInfo.dataCond;

  // Data repetition — structurally important, shown even in summary mode
  const repInfo = extractDataRepInfo(vs);
  if (repInfo) node.dataRep = repInfo;

  // In summary mode, skip styles, text, and attrs
  if (!options?.summaryOnly) {
    // CSS styles from the base variant's RuleSet
    if (
      !options?.excludeStyles &&
      rs?.values &&
      typeof rs.values === "object"
    ) {
      const values = { ...rs.values };
      // Filter internal visibility marker — not a real CSS property
      delete values["plasmic-display-none"];
      if (Object.keys(values).length > 0) {
        node.styles = values;

        // Resolve token references for display when styleTokens are provided
        if (options?.styleTokens?.length) {
          const tokenRefs = resolveStyleTokenRefs(values, options.styleTokens);
          if (Object.keys(tokenRefs).length > 0) {
            node.tokenRefs = tokenRefs;
          }
        }
      }
    }

    // Derive layout type and hint from flex/grid styles
    if (node.styles) {
      node.layoutType = deriveLayoutType(node.styles);
      node.layoutHint = deriveLayoutHint(node.styles);
    }

    // Text content (for text blocks)
    if (vs?.text) {
      const textInfo = extractText(vs.text);
      if (textInfo !== undefined) {
        node.text = textInfo.text;
        if (textInfo.marks?.length) {
          node.marks = textInfo.marks;
        }
        if (textInfo.dynamic) {
          node.dynamic = true;
        }
        if (textInfo.fallback != null) {
          node.fallback = textInfo.fallback;
        }
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

/**
 * Read a TplComponent node, separating slot override args (RenderExpr) from
 * non-slot prop args. Slot overrides become children grouped by slot name;
 * non-slot props appear in attrs. This matches Studio's tplChildren() traversal
 * pattern: getSlotArgs() → filter(isKnownRenderExpr) → flatMap(arg.expr.tpl).
 */
function readTplComponent(
  tpl: any,
  options: TreeReadOptions | undefined,
  depth: number
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

  // Separate slot args (RenderExpr) from non-slot prop args
  const vs = tpl.vsettings?.[0];
  const compRs = vs?.rs;

  // Visibility and data condition — structurally important, shown even in summary mode
  const compVisInfo = extractVisibilityInfo(vs, compRs);
  if (compVisInfo.visibility) node.visibility = compVisInfo.visibility;
  if (compVisInfo.dataCond) node.dataCond = compVisInfo.dataCond;

  // Data repetition — structurally important, shown even in summary mode
  const compRepInfo = extractDataRepInfo(vs);
  if (compRepInfo) node.dataRep = compRepInfo;

  const slotArgs: any[] = [];
  const nonSlotArgs: any[] = [];

  if (vs?.args?.length > 0) {
    for (const arg of vs.args) {
      if (isKnownRenderExpr(arg.expr)) {
        slotArgs.push(arg);
      } else {
        nonSlotArgs.push(arg);
      }
    }
  }

  // Count total slot override children for childCount
  const totalOverrideChildren = slotArgs.reduce(
    (count: number, arg: any) => count + (arg.expr.tpl?.length ?? 0),
    0
  );

  // In summary mode, include childCount and skip props
  if (options?.summaryOnly) {
    node.childCount = totalOverrideChildren;

    // Still traverse slot overrides if within maxDepth
    const shouldRecurse =
      options?.maxDepth === undefined || depth < options.maxDepth;
    if (shouldRecurse && slotArgs.length > 0) {
      const slotChildren = buildSlotChildren(slotArgs, options, depth);
      if (slotChildren.length > 0) {
        node.children = slotChildren;
      }
    }
    return node;
  }

  // CSS styles from the base variant's RuleSet — component instances can have
  // styles applied via RSH (forTag="div"), matching Studio behavior.
  if (
    !options?.excludeStyles &&
    compRs?.values &&
    typeof compRs.values === "object"
  ) {
    const values = { ...compRs.values };
    delete values["plasmic-display-none"];
    if (Object.keys(values).length > 0) {
      node.styles = values;

      if (options?.styleTokens?.length) {
        const tokenRefs = resolveStyleTokenRefs(values, options.styleTokens);
        if (Object.keys(tokenRefs).length > 0) {
          node.tokenRefs = tokenRefs;
        }
      }
    }
  }

  // Derive layout type and hint from flex/grid styles (same as TplTag)
  if (node.styles) {
    node.layoutType = deriveLayoutType(node.styles);
    node.layoutHint = deriveLayoutHint(node.styles);
  }

  // Non-slot args → attrs
  if (nonSlotArgs.length > 0) {
    const props: Record<string, unknown> = {};
    for (const arg of nonSlotArgs) {
      const paramName = arg.param?.variable?.name;
      if (!paramName) {continue;}

      const value = extractExprValue(arg.expr);
      if (value !== undefined) {
        props[paramName] = value;
      }
    }
    if (Object.keys(props).length > 0) {
      node.attrs = props;
    }
  }

  // Slot args → children grouped by slot name
  const shouldRecurse =
    options?.maxDepth === undefined || depth < options.maxDepth;

  if (slotArgs.length > 0) {
    if (shouldRecurse) {
      const slotChildren = buildSlotChildren(slotArgs, options, depth);
      if (slotChildren.length > 0) {
        node.children = slotChildren;
      }
    }
    if (!shouldRecurse) {
      node.childCount = totalOverrideChildren;
    }
  }

  return node;
}

/**
 * Build slot wrapper TreeNodes from slot args. Each wrapper groups the
 * override tpl nodes for a single slot under a type: "slot" node.
 */
function buildSlotChildren(
  slotArgs: any[],
  options: TreeReadOptions | undefined,
  depth: number
): TreeNode[] {
  const slotChildren: TreeNode[] = [];
  for (const arg of slotArgs) {
    const slotName = arg.param?.variable?.name ?? "unnamed";
    const slotTpls = arg.expr.tpl ?? [];
    if (slotTpls.length === 0) {continue;}

    const children = slotTpls
      .map((child: any) => readTplNode(child, options, depth + 1))
      .filter(Boolean) as TreeNode[];

    const slotNode: TreeNode = {
      type: "slot",
      slotName,
    };
    if (children.length > 0) {
      slotNode.children = children;
    }
    if (options?.summaryOnly) {
      slotNode.childCount = slotTpls.length;
    }
    slotChildren.push(slotNode);
  }
  return slotChildren;
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
  // TplComponent: traverse slot override content (RenderExpr.tpl[])
  if (isKnownTplComponent(tpl)) {
    const vs = tpl.vsettings?.[0];
    if (!vs?.args?.length) {return [];}
    const children: any[] = [];
    for (const arg of vs.args) {
      if (isKnownRenderExpr(arg.expr)) {
        children.push(...(arg.expr.tpl ?? []));
      }
    }
    return children;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Internal: Token resolution for style display
// ---------------------------------------------------------------------------

/**
 * Resolve var(--token-<uuid>) references in style values to display token names.
 * Replaces var() values with resolved CSS values and returns a map of
 * property → token name for the tokenRefs field.
 *
 * Mutates the `styles` object in place (replaces var() with resolved values).
 */
function resolveStyleTokenRefs(
  styles: Record<string, string>,
  styleTokens: any[]
): Record<string, string> {
  const tokenRefs: Record<string, string> = {};
  const tokenValueMap = new Map<string, string>();
  const tokenNameMap = new Map<string, string>();

  for (const t of styleTokens) {
    tokenValueMap.set(t.uuid, t.value);
    tokenNameMap.set(t.uuid, t.name);
  }

  for (const [prop, value] of Object.entries(styles)) {
    if (typeof value === "string" && isTokenRef(value)) {
      const uuid = parseTokenRefUuid(value);
      if (uuid && tokenNameMap.has(uuid)) {
        tokenRefs[prop] = tokenNameMap.get(uuid)!;
        // Replace var(--token-<uuid>) with resolved CSS value for display
        const rawValue = tokenValueMap.get(uuid) ?? value;
        styles[prop] = resolveTokenValue(rawValue, tokenValueMap);
      }
    }
  }

  return tokenRefs;
}

// ---------------------------------------------------------------------------
// Internal: Style and expression helpers
// ---------------------------------------------------------------------------

/**
 * Extract visibility and data condition info from a variant setting.
 * Visibility is derived from dataCond and the PLASMIC_DISPLAY_NONE internal marker:
 *   - dataCond = code("false") → notRendered (element removed from DOM)
 *   - dataCond = code("true") + PLASMIC_DISPLAY_NONE → displayNone (CSS hidden)
 *   - dataCond = custom expression → dataCond field with expression string
 *   - null/undefined dataCond → visible (omitted from output)
 */
function extractVisibilityInfo(
  vs: any,
  rs: any
): { visibility?: "notRendered" | "displayNone"; dataCond?: string } {
  if (!vs?.dataCond) return {};

  if (isKnownCustomCode(vs.dataCond)) {
    const code = vs.dataCond.code;
    if (code === "false") {
      return { visibility: "notRendered" };
    }
    if (code === "true") {
      if (rs?.values?.["plasmic-display-none"] === "true") {
        return { visibility: "displayNone" };
      }
      // Explicitly visible (no-op, same as default)
      return {};
    }
    // Custom condition expression
    return { dataCond: code };
  }

  if (isKnownObjectPath(vs.dataCond)) {
    return { dataCond: vs.dataCond.path.join(".") };
  }

  return {};
}

/**
 * Extract data repetition info from a variant setting's dataRep field.
 * Returns a structured object with collection expression and variable names,
 * or null if no repetition is set.
 */
function extractDataRepInfo(
  vs: any
): { collection: string; elementVariable: string; indexVariable?: string } | null {
  const rep = vs?.dataRep;
  if (!rep) return null;

  let collection: string;
  if (isKnownCustomCode(rep.collection)) {
    collection = rep.collection.code;
  } else if (isKnownObjectPath(rep.collection)) {
    collection = rep.collection.path.join(".");
  } else {
    return null;
  }

  const result: { collection: string; elementVariable: string; indexVariable?: string } = {
    collection,
    elementVariable: rep.element?.name ?? "currentItem",
  };

  if (rep.index?.name) {
    result.indexVariable = rep.index.name;
  }

  return result;
}

function deriveLayoutType(
  styles: Record<string, string>
): "vbox" | "hbox" | "box" {
  const flexDirection = styles["flexDirection"] || styles["flex-direction"];
  if (flexDirection === "column" || flexDirection === "column-reverse") {return "vbox";}
  if (flexDirection === "row" || flexDirection === "row-reverse") {return "hbox";}

  const display = styles["display"];
  if (display === "flex" || display === "inline-flex") {
    return "hbox"; // Default flex direction is row
  }

  return "box";
}

/**
 * Derives a semantic layout hint from CSS styles.
 * More descriptive than layoutType — detects grid layouts and uses
 * clearer names (flex-row/flex-col instead of hbox/vbox).
 */
function deriveLayoutHint(
  styles: Record<string, string>
): "flex-row" | "flex-col" | "grid" | "block" {
  const display = styles["display"];
  if (display === "grid" || display === "inline-grid") {return "grid";}

  const flexDirection = styles["flexDirection"] || styles["flex-direction"];
  if (flexDirection === "column" || flexDirection === "column-reverse") {return "flex-col";}
  if (flexDirection === "row" || flexDirection === "row-reverse") {return "flex-row";}

  if (display === "flex" || display === "inline-flex") {
    return "flex-row"; // Default flex direction is row
  }

  return "block";
}

/**
 * Extract text content from a RawText or ExprText node.
 * Returns { text, dynamic, fallback } for dynamic text to enable
 * proper display in tree output.
 */
function extractText(richText: any): { text: string; marks?: TreeNodeMark[]; dynamic?: boolean; fallback?: string } | undefined {
  if (isKnownRawText(richText)) {
    // Check for inline formatting markers
    if (richText.markers?.length > 0) {
      return extractRichText(richText);
    }
    return { text: richText.text };
  }
  if (isKnownExprText(richText)) {
    const expr = richText.expr;
    let text: string;
    let fallback: string | undefined;

    if (isKnownCustomCode(expr)) {
      text = expr.code;
      fallback = extractFallbackValue(expr.fallback);
    } else if (isKnownObjectPath(expr)) {
      // Display ObjectPath as dot notation (e.g., "$ctx.product.name")
      text = expr.path.join(".");
      fallback = extractFallbackValue(expr.fallback);
    } else if (isKnownVarRef(expr)) {
      text = `$${expr.variable?.name ?? "var"}`;
    } else {
      text = "[dynamic text]";
    }

    return { text, dynamic: true, ...(fallback != null ? { fallback } : {}) };
  }
  return undefined;
}

/**
 * Map a StyleMarker's CSS properties back to user-facing mark types.
 * Returns the mark type string or null if the CSS doesn't match a known mark.
 */
const CSS_TO_MARK_TYPE: Record<string, Record<string, string>> = {
  "font-weight": { "700": "bold", "bold": "bold" },
  "font-style": { "italic": "italic" },
  "text-decoration-line": { "underline": "underline", "line-through": "strikethrough" },
};

function styleMarkerToMarkType(rs: any): string | null {
  if (!rs?.values) return null;
  for (const [prop, valueMap] of Object.entries(CSS_TO_MARK_TYPE)) {
    const value = rs.values[prop];
    if (value && (valueMap as Record<string, string>)[value]) {
      return (valueMap as Record<string, string>)[value];
    }
  }
  return null;
}

/**
 * Extract rich text content from a RawText with markers.
 *
 * Reconstructs the user-visible text by replacing [child] placeholders with
 * the actual text content from NodeMarker TplTags. Builds a marks array
 * in user text coordinates.
 */
function extractRichText(rawText: any): { text: string; marks: TreeNodeMark[] } {
  const wabText: string = rawText.text;
  const markers: any[] = rawText.markers;

  // Sort markers by position
  const sortedMarkers = [...markers].sort((a: any, b: any) => a.position - b.position);

  // Collect NodeMarkers to reconstruct user text
  const nodeMarkers = sortedMarkers.filter((m: any) => isKnownNodeMarker(m));
  const styleMarkers = sortedMarkers.filter((m: any) => isKnownStyleMarker(m));

  // Reconstruct user text by replacing [child] placeholders with actual text
  let userText = "";
  const marks: TreeNodeMark[] = [];
  let wabCursor = 0;
  let userCursor = 0;

  // Build a position map: for each NodeMarker, map WAB position to user text position
  const nodeMarkerMap: { wabStart: number; wabEnd: number; userStart: number; userEnd: number; tag: string; href?: string }[] = [];

  for (const nm of nodeMarkers) {
    // Add text before this NodeMarker
    const beforeText = wabText.slice(wabCursor, nm.position);
    userText += beforeText;
    userCursor += beforeText.length;

    // Get the actual text from the NodeMarker's TplTag
    const childText = extractNodeMarkerText(nm.tpl);
    const userStart = userCursor;
    userText += childText;
    userCursor += childText.length;
    const userEnd = userCursor;

    const tag = nm.tpl?.tag ?? "span";
    const href = extractNodeMarkerHref(nm.tpl);

    nodeMarkerMap.push({
      wabStart: nm.position,
      wabEnd: nm.position + nm.length,
      userStart,
      userEnd,
      tag,
      href,
    });

    // Create mark for this NodeMarker
    if (tag === "a" && href) {
      marks.push({ start: userStart, end: userEnd, type: "link", href });
    } else if (tag === "code") {
      marks.push({ start: userStart, end: userEnd, type: "code" });
    }

    wabCursor = nm.position + nm.length;
  }

  // Add remaining text after last NodeMarker
  userText += wabText.slice(wabCursor);

  // Convert StyleMarkers to user-facing marks
  for (const sm of styleMarkers) {
    const markType = styleMarkerToMarkType(sm.rs);
    if (!markType) continue;

    // Convert WAB position to user position
    const userStart = wabPosToUserPos(sm.position, nodeMarkerMap);
    const userEnd = wabPosToUserPos(sm.position + sm.length, nodeMarkerMap);

    if (userEnd > userStart) {
      marks.push({ start: userStart, end: userEnd, type: markType as TreeNodeMark["type"] });
    }
  }

  // Also extract StyleMarkers from child TplTag RawTexts (marks inside NodeMarkers)
  for (const nmInfo of nodeMarkerMap) {
    const nm = nodeMarkers.find((m: any) => m.position === nmInfo.wabStart);
    if (!nm?.tpl) continue;

    const childRawText = nm.tpl.vsettings?.[0]?.text;
    if (!childRawText || !isKnownRawText(childRawText)) continue;

    for (const childMarker of childRawText.markers ?? []) {
      if (!isKnownStyleMarker(childMarker)) continue;
      const markType = styleMarkerToMarkType(childMarker.rs);
      if (!markType) continue;

      marks.push({
        start: nmInfo.userStart + childMarker.position,
        end: nmInfo.userStart + childMarker.position + childMarker.length,
        type: markType as TreeNodeMark["type"],
      });
    }
  }

  // Sort marks by start position for consistent output
  marks.sort((a, b) => a.start - b.start || a.end - b.end);

  return { text: userText, marks };
}

/** Get text content from a NodeMarker's TplTag. */
function extractNodeMarkerText(tpl: any): string {
  if (!tpl) return "";
  const vs = tpl.vsettings?.[0];
  if (!vs?.text) return "";
  if (isKnownRawText(vs.text)) return vs.text.text;
  return "";
}

/** Get href attribute from a NodeMarker's TplTag (for links). */
function extractNodeMarkerHref(tpl: any): string | undefined {
  if (!tpl) return undefined;
  const vs = tpl.vsettings?.[0];
  if (!vs?.attrs?.href) return undefined;
  const hrefExpr = vs.attrs.href;
  if (isKnownCustomCode(hrefExpr)) {
    try {
      return JSON.parse(hrefExpr.code);
    } catch {
      return hrefExpr.code;
    }
  }
  return undefined;
}

/**
 * Convert a WAB text position to a user text position.
 * Accounts for [child] placeholder offsets from NodeMarkers.
 */
function wabPosToUserPos(
  wabPos: number,
  nodeMarkerMap: { wabStart: number; wabEnd: number; userStart: number; userEnd: number }[]
): number {
  let offset = 0;
  for (const nm of nodeMarkerMap) {
    if (wabPos <= nm.wabStart) break;
    if (wabPos >= nm.wabEnd) {
      // Past this NodeMarker — adjust by the difference between [child] length and user text length
      offset += (nm.userEnd - nm.userStart) - (nm.wabEnd - nm.wabStart);
    } else {
      // Inside the [child] placeholder — map to start of user text for this NodeMarker
      return nm.userStart;
    }
  }
  return wabPos + offset;
}

/** Extract the string value from a fallback expression (typically a CustomCode wrapping a JSON string). */
function extractFallbackValue(fallback: any): string | undefined {
  if (!fallback) return undefined;
  if (isKnownCustomCode(fallback)) {
    try {
      return JSON.parse(fallback.code);
    } catch {
      return fallback.code;
    }
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
  if (!expr) {return undefined;}

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
    const asset = expr.asset;
    if (asset) {
      return {
        assetUuid: asset.uuid,
        assetName: asset.name,
        assetType: asset.type,
        src: asset.dataUri ?? asset.url ?? "[image]",
      };
    }
    return "[image]";
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

  if (isKnownObjectPath(expr)) {
    return expr.path.join(".");
  }

  if (isKnownVarRef(expr)) {
    return `$${expr.variable?.name ?? "var"}`;
  }

  return undefined;
}
