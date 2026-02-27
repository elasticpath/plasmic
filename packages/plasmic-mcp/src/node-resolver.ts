/**
 * Node resolution: find TplNode instances in the Tpl tree by UUID, name, path,
 * index, or text content.
 *
 * Used by all edit tools to locate the target node from a human-readable reference.
 * Returns all matching candidates when ambiguous, so the skill layer can ask the
 * developer to disambiguate.
 *
 * Reference types:
 *   - UUID: exact match (e.g., "abc-123")
 *   - Name: component-scoped name (e.g., "Hero Title")
 *   - Path: dot-separated ancestor path (e.g., "HeroSection.Title")
 *   - Index: positional within root's children (e.g., "#2" for third child)
 *   - Content: text content match with ~ prefix (e.g., "~Hello World")
 *
 * M3 additions:
 *   Module-level cache of flattened node lists per component UUID. Avoids re-walking
 *   the tree on every resolve call during batch edits. Structural edits (add-child,
 *   remove-child, move-child) invalidate the affected component's cache entry.
 *   Text/style edits leave the cache valid since they don't change tree structure.
 *
 * Cache metrics: hit/miss counters exposed via getCacheMetrics() for performance
 * monitoring. Included in tool response metadata when available.
 *
 * Reference: specs/plasmic-incremental-writes.md § Node Resolution
 */

import {
  isKnownTplTag,
  isKnownTplSlot,
  isKnownTplComponent,
  isKnownRawText,
  isKnownRenderExpr,
} from "@/wab/shared/model/classes";

export interface ResolvedNode {
  /** The live TplNode instance from the in-memory model. */
  node: any;
  uuid: string;
  name?: string;
  /** Dot-separated path from root (e.g., "root.HeroSection.Title"). */
  path: string;
  /** The owning Component instance. */
  component: any;
}

export interface ResolveResult {
  nodes: ResolvedNode[];
  /** True when multiple nodes matched a name/path reference. */
  isAmbiguous: boolean;
}

// ---------------------------------------------------------------------------
// Node resolver cache
// ---------------------------------------------------------------------------

/** Cached flattened node lists keyed by component UUID. */
const nodeCache = new Map<string, ResolvedNode[]>();

/** Cache hit/miss counters for performance monitoring. */
let cacheHits = 0;
let cacheMisses = 0;

export interface CacheMetrics {
  hits: number;
  misses: number;
  /** Hit rate as a percentage (0–100). Returns 0 when no lookups have occurred. */
  hitRate: number;
  /** Number of components currently cached. */
  cachedComponents: number;
}

/** Get cache hit/miss metrics for monitoring and debugging. */
export function getCacheMetrics(): CacheMetrics {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: total > 0 ? Math.round((cacheHits / total) * 100) : 0,
    cachedComponents: nodeCache.size,
  };
}

/** Reset cache metrics (for testing). */
export function resetCacheMetrics(): void {
  cacheHits = 0;
  cacheMisses = 0;
}

/** Invalidate the cached node list for a specific component (after structural edits). */
export function invalidateNodeCache(componentUuid: string): void {
  nodeCache.delete(componentUuid);
}

/** Clear the entire node cache (after project.set or project.refresh). */
export function clearNodeCache(): void {
  nodeCache.clear();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a node reference within a component's Tpl tree.
 *
 * Reference types (tried in order):
 * 1. UUID: exact match (e.g., "abc-123")
 * 2. Index: positional within root's children (e.g., "#2" for third child)
 * 3. Path: dot-separated ancestor path (e.g., "HeroSection.Title")
 * 4. Name: component-scoped name (e.g., "Hero Title")
 * 5. Content: text content match with ~ prefix (e.g., "~Hello World")
 */
export function resolveNode(component: any, nodeRef: string): ResolveResult {
  const tplTree = component.tplTree;
  if (!tplTree) {
    return { nodes: [], isAmbiguous: false };
  }

  // Check cache first, flatten only on miss
  const cacheKey = component.uuid;
  let allNodes: ResolvedNode[];
  if (cacheKey && nodeCache.has(cacheKey)) {
    allNodes = nodeCache.get(cacheKey)!;
    cacheHits++;
  } else {
    allNodes = flattenWithPaths(tplTree, component);
    if (cacheKey) {
      nodeCache.set(cacheKey, allNodes);
    }
    cacheMisses++;
  }

  // Try UUID match first (most specific)
  const uuidMatch = allNodes.filter((n) => n.uuid === nodeRef);
  if (uuidMatch.length === 1) {
    return { nodes: uuidMatch, isAmbiguous: false };
  }

  // Try index match (#N)
  if (nodeRef.startsWith("#")) {
    const index = parseInt(nodeRef.slice(1), 10);
    if (!isNaN(index)) {
      return resolveByIndex(tplTree, index, component);
    }
  }

  // Try path match (contains dots)
  if (nodeRef.includes(".")) {
    const pathMatches = allNodes.filter((n) => n.path.endsWith(nodeRef));
    if (pathMatches.length >= 1) {
      return {
        nodes: pathMatches,
        isAmbiguous: pathMatches.length > 1,
      };
    }
  }

  // Try name match (component-scoped)
  const nameMatches = allNodes.filter((n) => n.name === nodeRef);
  if (nameMatches.length >= 1) {
    return {
      nodes: nameMatches,
      isAmbiguous: nameMatches.length > 1,
    };
  }

  // Try content match (~text) — searches node text content (case-insensitive)
  if (nodeRef.startsWith("~")) {
    const searchText = nodeRef.slice(1).toLowerCase();
    if (searchText.length > 0) {
      const contentMatches = allNodes.filter((n) => {
        const text = getNodeTextContent(n.node);
        return text !== undefined && text.toLowerCase().includes(searchText);
      });
      if (contentMatches.length >= 1) {
        return {
          nodes: contentMatches,
          isAmbiguous: contentMatches.length > 1,
        };
      }
    }
  }

  // Nothing found
  return { nodes: [], isAmbiguous: false };
}

/**
 * Require exactly one node from a resolve result.
 * Throws descriptive errors for no-match and ambiguous-match cases.
 */
export function requireSingleNode(
  result: ResolveResult,
  nodeRef: string
): ResolvedNode {
  if (result.nodes.length === 0) {
    throw new Error(
      `Node "${nodeRef}" not found. Use get-component-tree to see available nodes.`
    );
  }
  if (result.isAmbiguous) {
    const candidates = result.nodes
      .map(
        (n) =>
          `  - "${n.name ?? n.uuid}" (UUID: ${n.uuid}, path: ${n.path})`
      )
      .join("\n");
    throw new Error(
      `Node reference "${nodeRef}" is ambiguous. ${result.nodes.length} matches found:\n${candidates}\nUse a UUID for an exact match.`
    );
  }
  return result.nodes[0];
}

/**
 * Maximum tree depth to prevent stack overflow on malformed models.
 * WAB models are typically < 30 levels deep; 200 is a generous safety limit.
 */
const MAX_TREE_DEPTH = 200;

/**
 * Flatten the Tpl tree into a list of nodes with path metadata.
 *
 * For TplComponent nodes, slot override children are traversed with the slot
 * name inserted as a path segment: e.g., Card.children.Title. This matches
 * Studio's tplChildren() traversal via getSlotArgs() → RenderExpr.tpl[].
 *
 * Cycle protection: a visited-UUID Set prevents infinite recursion if the
 * in-memory model ever contains a cycle (e.g., due to model corruption).
 * A depth limit guards against stack overflow from extremely deep trees.
 */
function flattenWithPaths(
  tpl: any,
  component: any,
  parentPath = "",
  visited: Set<string> = new Set(),
  depth = 0
): ResolvedNode[] {
  // Cycle guard: skip nodes we've already visited
  const nodeId = tpl.uuid;
  if (nodeId && visited.has(nodeId)) {
    return [];
  }

  // Depth guard: prevent stack overflow on extremely deep or cyclic trees
  if (depth > MAX_TREE_DEPTH) {
    return [];
  }

  if (nodeId) {
    visited.add(nodeId);
  }

  const result: ResolvedNode[] = [];
  const name = getNodeName(tpl);
  const segment = name || tpl.uuid || "node";
  const currentPath = parentPath ? `${parentPath}.${segment}` : segment;

  result.push({
    node: tpl,
    uuid: tpl.uuid ?? "",
    name: name || undefined,
    path: currentPath,
    component,
  });

  // TplComponent: traverse slot overrides with slot name in path
  if (isKnownTplComponent(tpl)) {
    const vs = tpl.vsettings?.[0];
    if (vs?.args?.length) {
      for (const arg of vs.args) {
        if (isKnownRenderExpr(arg.expr)) {
          const slotName = arg.param?.variable?.name ?? "slot";
          const slotPath = `${currentPath}.${slotName}`;
          for (const child of arg.expr.tpl ?? []) {
            result.push(...flattenWithPaths(child, component, slotPath, visited, depth + 1));
          }
        }
      }
    }
  } else {
    const children = getChildren(tpl);
    for (const child of children) {
      result.push(...flattenWithPaths(child, component, currentPath, visited, depth + 1));
    }
  }

  return result;
}

function getNodeName(tpl: any): string | undefined {
  if (tpl.name) {return tpl.name;}
  return undefined;
}

/**
 * Extract text content from a TplTag node's base variant setting.
 * Returns undefined for non-text nodes or nodes without text content.
 */
function getNodeTextContent(tpl: any): string | undefined {
  if (!isKnownTplTag(tpl)) {return undefined;}
  const vs = tpl.vsettings?.[0];
  if (!vs?.text) {return undefined;}
  if (isKnownRawText(vs.text)) {return vs.text.text;}
  return undefined;
}

function getChildren(tpl: any): any[] {
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

function resolveByIndex(
  tplTree: any,
  index: number,
  component: any
): ResolveResult {
  // Index resolves to the Nth child of the root node
  const rootChildren = getChildren(tplTree);
  if (index >= 0 && index < rootChildren.length) {
    const child = rootChildren[index];
    const name = getNodeName(child);
    return {
      nodes: [
        {
          node: child,
          uuid: child.uuid ?? "",
          name: name || undefined,
          path: `${getNodeName(tplTree) || tplTree.uuid || "root"}.#${index}`,
          component,
        },
      ],
      isAmbiguous: false,
    };
  }
  return { nodes: [], isAmbiguous: false };
}
