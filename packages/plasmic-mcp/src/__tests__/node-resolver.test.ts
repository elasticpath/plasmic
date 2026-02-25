/**
 * Unit tests for node-resolver.ts
 *
 * Node resolution is the foundation of all edit tools — every mutation starts
 * by finding the target node. Incorrect resolution means edits land on the
 * wrong element, so these tests verify all four reference types and error cases.
 */

import {
  resolveNode,
  requireSingleNode,
  clearNodeCache,
  invalidateNodeCache,
  getCacheMetrics,
  resetCacheMetrics,
} from "../node-resolver";

/** Helper: create a mock TplTag node */
function mkTag(
  uuid: string,
  name?: string,
  children?: any[]
): any {
  return {
    _type: "TplTag",
    uuid,
    name: name ?? undefined,
    children: children ?? [],
    tag: "div",
  };
}

/** Helper: create a mock TplTag node with text content */
function mkTextTag(
  uuid: string,
  name: string,
  text: string,
  children?: any[]
): any {
  return {
    _type: "TplTag",
    uuid,
    name,
    children: children ?? [],
    tag: "div",
    vsettings: [
      {
        text: { _type: "RawText", text },
        rs: { values: {} },
      },
    ],
  };
}

/** Helper: create a mock TplSlot node */
function mkSlot(uuid: string, name?: string, defaultContents?: any[]): any {
  return {
    _type: "TplSlot",
    uuid,
    name: name ?? undefined,
    defaultContents: defaultContents ?? [],
    param: { variable: { name: name ?? "unnamed" } },
  };
}

/** Helper: create a component with a tplTree */
function mkComponent(tplTree: any): any {
  return { uuid: "comp-1", name: "TestComponent", tplTree };
}

beforeEach(() => {
  clearNodeCache();
  resetCacheMetrics();
});

describe("resolveNode", () => {
  describe("UUID lookup", () => {
    it("finds a node by exact UUID", () => {
      const child = mkTag("child-uuid", "Child");
      const root = mkTag("root-uuid", "Root", [child]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "child-uuid");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(child);
      expect(result.nodes[0].uuid).toBe("child-uuid");
      expect(result.isAmbiguous).toBe(false);
    });

    it("finds the root node by UUID", () => {
      const root = mkTag("root-uuid", "Root");
      const comp = mkComponent(root);

      const result = resolveNode(comp, "root-uuid");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(root);
    });

    it("returns empty for non-existent UUID", () => {
      const root = mkTag("root-uuid", "Root");
      const comp = mkComponent(root);

      const result = resolveNode(comp, "nonexistent-uuid");

      expect(result.nodes).toHaveLength(0);
      expect(result.isAmbiguous).toBe(false);
    });
  });

  describe("name lookup", () => {
    it("finds a node by name", () => {
      const title = mkTag("t1", "Hero Title");
      const root = mkTag("root", "Root", [title]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "Hero Title");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(title);
      expect(result.isAmbiguous).toBe(false);
    });

    it("reports ambiguity when multiple nodes share a name", () => {
      const item1 = mkTag("i1", "ListItem");
      const item2 = mkTag("i2", "ListItem");
      const root = mkTag("root", "Root", [item1, item2]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "ListItem");

      expect(result.nodes).toHaveLength(2);
      expect(result.isAmbiguous).toBe(true);
    });

    it("returns empty for non-existent name", () => {
      const root = mkTag("root", "Root");
      const comp = mkComponent(root);

      const result = resolveNode(comp, "Nonexistent");

      expect(result.nodes).toHaveLength(0);
    });
  });

  describe("path lookup", () => {
    it("finds a node by dot-separated path", () => {
      const title = mkTag("t1", "Title");
      const section = mkTag("s1", "HeroSection", [title]);
      const root = mkTag("root", "Root", [section]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "HeroSection.Title");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(title);
    });

    it("matches partial path suffix", () => {
      const deep = mkTag("d1", "Button");
      const mid = mkTag("m1", "Card", [deep]);
      const outer = mkTag("o1", "Section", [mid]);
      const root = mkTag("root", "Root", [outer]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "Card.Button");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(deep);
    });
  });

  describe("index lookup", () => {
    it("finds a child by #N index", () => {
      const first = mkTag("c0", "First");
      const second = mkTag("c1", "Second");
      const third = mkTag("c2", "Third");
      const root = mkTag("root", "Root", [first, second, third]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "#1");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(second);
    });

    it("returns empty for out-of-range index", () => {
      const root = mkTag("root", "Root", [mkTag("c0")]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "#5");

      expect(result.nodes).toHaveLength(0);
    });

    it("handles #0 (first child)", () => {
      const first = mkTag("c0", "First");
      const root = mkTag("root", "Root", [first]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "#0");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(first);
    });
  });

  describe("slot traversal", () => {
    it("traverses into TplSlot default contents", () => {
      const slotChild = mkTag("sc1", "SlotContent");
      const slot = mkSlot("slot1", "children", [slotChild]);
      const root = mkTag("root", "Root", [slot]);
      const comp = mkComponent(root);

      const result = resolveNode(comp, "SlotContent");

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].node).toBe(slotChild);
    });
  });

  describe("empty tree", () => {
    it("handles component with no tplTree", () => {
      const comp = { uuid: "comp-1", name: "Empty" };

      const result = resolveNode(comp, "anything");

      expect(result.nodes).toHaveLength(0);
    });
  });
});

describe("requireSingleNode", () => {
  it("returns the single matched node", () => {
    const node = mkTag("n1", "Title");
    const result = {
      nodes: [{ node, uuid: "n1", name: "Title", path: "Root.Title", component: {} }],
      isAmbiguous: false,
    };

    const resolved = requireSingleNode(result, "Title");
    expect(resolved.node).toBe(node);
  });

  it("throws with guidance when no node found", () => {
    const result = { nodes: [], isAmbiguous: false };

    expect(() => requireSingleNode(result, "Missing")).toThrow(
      'Node "Missing" not found'
    );
    expect(() => requireSingleNode(result, "Missing")).toThrow(
      "get-component-tree"
    );
  });

  it("throws with candidates when ambiguous", () => {
    const result = {
      nodes: [
        { node: {}, uuid: "a1", name: "Item", path: "Root.Item", component: {} },
        { node: {}, uuid: "a2", name: "Item", path: "Root.List.Item", component: {} },
      ],
      isAmbiguous: true,
    };

    expect(() => requireSingleNode(result, "Item")).toThrow("ambiguous");
    expect(() => requireSingleNode(result, "Item")).toThrow("2 matches");
    expect(() => requireSingleNode(result, "Item")).toThrow("a1");
    expect(() => requireSingleNode(result, "Item")).toThrow("a2");
  });
});

// =============================================================================
// M3: Node resolver caching
//
// The cache avoids re-flattening the Tpl tree on every resolve call during
// batch edits. Structural edits (add/remove/move) must invalidate; text/style
// edits must NOT invalidate (they don't change tree structure).
// =============================================================================

describe("node resolver cache", () => {
  it("caches flattened node list — second resolve does not re-walk tree", () => {
    const child = mkTag("c1", "Child");
    const root = mkTag("root", "Root", [child]);
    const comp = mkComponent(root);

    // First call populates cache
    const result1 = resolveNode(comp, "Child");
    expect(result1.nodes).toHaveLength(1);

    // Mutate the tree (add a sibling) WITHOUT invalidating cache
    const newChild = mkTag("c2", "NewChild");
    root.children.push(newChild);

    // Second call returns cached data (doesn't see the new child)
    const result2 = resolveNode(comp, "NewChild");
    expect(result2.nodes).toHaveLength(0); // stale cache

    // After invalidation, the new child is visible
    invalidateNodeCache("comp-1");
    const result3 = resolveNode(comp, "NewChild");
    expect(result3.nodes).toHaveLength(1);
    expect(result3.nodes[0].node).toBe(newChild);
  });

  it("clearNodeCache clears all cached entries", () => {
    const root1 = mkTag("r1", "Root1");
    const comp1 = { uuid: "comp-A", name: "CompA", tplTree: root1 };
    const root2 = mkTag("r2", "Root2");
    const comp2 = { uuid: "comp-B", name: "CompB", tplTree: root2 };

    // Populate cache for two components
    resolveNode(comp1, "Root1");
    resolveNode(comp2, "Root2");

    // Mutate both trees
    root1.children = [mkTag("new-A", "NewA")];
    root2.children = [mkTag("new-B", "NewB")];

    // Cache is stale — mutations not visible
    expect(resolveNode(comp1, "NewA").nodes).toHaveLength(0);
    expect(resolveNode(comp2, "NewB").nodes).toHaveLength(0);

    // clearNodeCache makes both fresh
    clearNodeCache();
    expect(resolveNode(comp1, "NewA").nodes).toHaveLength(1);
    expect(resolveNode(comp2, "NewB").nodes).toHaveLength(1);
  });

  it("invalidateNodeCache only clears the specified component", () => {
    const root1 = mkTag("r1", "Root1");
    const comp1 = { uuid: "comp-X", name: "CompX", tplTree: root1 };
    const root2 = mkTag("r2", "Root2");
    const comp2 = { uuid: "comp-Y", name: "CompY", tplTree: root2 };

    // Populate both caches
    resolveNode(comp1, "Root1");
    resolveNode(comp2, "Root2");

    // Mutate comp1's tree, invalidate only comp1
    root1.children = [mkTag("new-X", "NewX")];
    invalidateNodeCache("comp-X");

    // comp-X sees the new child, comp-Y still cached
    expect(resolveNode(comp1, "NewX").nodes).toHaveLength(1);

    // comp-Y mutation NOT visible (cache intact)
    root2.children = [mkTag("new-Y", "NewY")];
    expect(resolveNode(comp2, "NewY").nodes).toHaveLength(0);
  });

  it("works correctly with component that has no uuid", () => {
    const root = mkTag("r1", "Root");
    const comp = { name: "NoUuid", tplTree: root };

    // Should not throw, just not cache (no uuid key)
    const result = resolveNode(comp, "Root");
    expect(result.nodes).toHaveLength(1);
  });
});

// =============================================================================
// Content-based node resolution (~text prefix)
//
// Finds nodes by their text content (case-insensitive substring match).
// Useful when the developer knows the visible text but not the node name/UUID.
// =============================================================================

describe("content-based resolution", () => {
  it("finds a node by text content using ~ prefix", () => {
    const title = mkTextTag("t1", "Title", "Welcome to our site");
    const root = mkTag("root", "Root", [title]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~Welcome");

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].node).toBe(title);
    expect(result.isAmbiguous).toBe(false);
  });

  it("matches case-insensitively", () => {
    const title = mkTextTag("t1", "Title", "Hello World");
    const root = mkTag("root", "Root", [title]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~hello world");

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].node).toBe(title);
  });

  it("matches substring of text content", () => {
    const para = mkTextTag("p1", "Paragraph", "This is a long paragraph with details");
    const root = mkTag("root", "Root", [para]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~long paragraph");

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].node).toBe(para);
  });

  it("reports ambiguity when multiple nodes contain the same text", () => {
    const item1 = mkTextTag("i1", "Item1", "Buy now");
    const item2 = mkTextTag("i2", "Item2", "Buy now for less");
    const root = mkTag("root", "Root", [item1, item2]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~Buy now");

    expect(result.nodes).toHaveLength(2);
    expect(result.isAmbiguous).toBe(true);
  });

  it("returns empty when no text matches", () => {
    const title = mkTextTag("t1", "Title", "Hello");
    const root = mkTag("root", "Root", [title]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~Goodbye");

    expect(result.nodes).toHaveLength(0);
  });

  it("ignores non-text nodes (containers)", () => {
    const container = mkTag("c1", "Container"); // no text
    const root = mkTag("root", "Root", [container]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~anything");

    expect(result.nodes).toHaveLength(0);
  });

  it("handles empty search text after ~", () => {
    const title = mkTextTag("t1", "Title", "Hello");
    const root = mkTag("root", "Root", [title]);
    const comp = mkComponent(root);

    const result = resolveNode(comp, "~");

    expect(result.nodes).toHaveLength(0);
  });

  it("prefers name match over content match for same string", () => {
    // Node named "Hello" with text "Goodbye" — name should match, not content
    const node = mkTextTag("n1", "Hello", "Goodbye");
    const root = mkTag("root", "Root", [node]);
    const comp = mkComponent(root);

    // Name match (no ~ prefix) should find the node by name
    const nameResult = resolveNode(comp, "Hello");
    expect(nameResult.nodes).toHaveLength(1);
    expect(nameResult.nodes[0].name).toBe("Hello");

    // Content match (~ prefix) should find the node by text
    const contentResult = resolveNode(comp, "~Goodbye");
    expect(contentResult.nodes).toHaveLength(1);
    expect(contentResult.nodes[0].node).toBe(node);
  });
});

// =============================================================================
// Cache hit/miss metrics
//
// Exposed via getCacheMetrics() for debugging and performance monitoring.
// Metrics track how often the flattened node list is served from cache vs.
// re-computed from the tree.
// =============================================================================

describe("cache metrics", () => {
  it("starts at zero", () => {
    const metrics = getCacheMetrics();
    expect(metrics.hits).toBe(0);
    expect(metrics.misses).toBe(0);
    expect(metrics.hitRate).toBe(0);
    expect(metrics.cachedComponents).toBe(0);
  });

  it("records a miss on first resolve", () => {
    const root = mkTag("r1", "Root");
    const comp = mkComponent(root);

    resolveNode(comp, "Root");

    const metrics = getCacheMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(0);
    expect(metrics.cachedComponents).toBe(1);
  });

  it("records a hit on subsequent resolves for the same component", () => {
    const root = mkTag("r1", "Root");
    const comp = mkComponent(root);

    resolveNode(comp, "Root"); // miss
    resolveNode(comp, "Root"); // hit
    resolveNode(comp, "Root"); // hit

    const metrics = getCacheMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(2);
    expect(metrics.hitRate).toBe(67); // 2/3 ≈ 67%
  });

  it("records a miss after invalidation", () => {
    const root = mkTag("r1", "Root");
    const comp = mkComponent(root);

    resolveNode(comp, "Root"); // miss
    resolveNode(comp, "Root"); // hit

    invalidateNodeCache("comp-1");
    resolveNode(comp, "Root"); // miss again

    const metrics = getCacheMetrics();
    expect(metrics.misses).toBe(2);
    expect(metrics.hits).toBe(1);
  });

  it("resetCacheMetrics clears counters", () => {
    const root = mkTag("r1", "Root");
    const comp = mkComponent(root);

    resolveNode(comp, "Root"); // miss
    resolveNode(comp, "Root"); // hit

    resetCacheMetrics();

    const metrics = getCacheMetrics();
    expect(metrics.hits).toBe(0);
    expect(metrics.misses).toBe(0);
  });
});
