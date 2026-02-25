/**
 * Node resolution: find TplNode instances in the Tpl tree by UUID, name, path, or index.
 *
 * Used by all edit tools to locate the target node from a human-readable reference.
 * Returns all matching candidates when ambiguous, so the skill layer can ask the
 * developer to disambiguate.
 *
 * M3 additions:
 *   Module-level cache of flattened node lists per component UUID. Avoids re-walking
 *   the tree on every resolve call during batch edits. Structural edits (add-child,
 *   remove-child, move-child) invalidate the affected component's cache entry.
 *   Text/style edits leave the cache valid since they don't change tree structure.
 *
 * Reference: specs/plasmic-incremental-writes.md § Node Resolution
 */

import {
  isKnownTplTag,
  isKnownTplSlot,
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

/** Invalidate the cached node list for a specific component (after structural edits). */
export function invalidateNodeCache(componentUuid: string): void {
  nodeCache.delete(componentUuid);
}

/** Clear the entire node cache (after set-project or refresh-project). */
export function clearNodeCache(): void {
  nodeCache.clear();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a node reference within a component's Tpl tree.
 *
 * Reference types:
 * - UUID: exact match (e.g., "abc-123")
 * - Name: component-scoped name (e.g., "Hero Title")
 * - Path: dot-separated ancestor path (e.g., "HeroSection.Title")
 * - Index: positional within root's children (e.g., "#2" for third child)
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
  } else {
    allNodes = flattenWithPaths(tplTree, component);
    if (cacheKey) {
      nodeCache.set(cacheKey, allNodes);
    }
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
 * Flatten the Tpl tree into a list of nodes with path metadata.
 */
function flattenWithPaths(
  tpl: any,
  component: any,
  parentPath = ""
): ResolvedNode[] {
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

  const children = getChildren(tpl);
  for (const child of children) {
    result.push(...flattenWithPaths(child, component, currentPath));
  }

  return result;
}

function getNodeName(tpl: any): string | undefined {
  if (tpl.name) return tpl.name;
  return undefined;
}

function getChildren(tpl: any): any[] {
  if (isKnownTplTag(tpl)) {
    return tpl.children ?? [];
  }
  if (isKnownTplSlot(tpl)) {
    return tpl.defaultContents ?? [];
  }
  // TplComponent: don't traverse into component instances for resolution
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
