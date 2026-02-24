/**
 * Unit tests for node-resolver.ts
 *
 * Node resolution is the foundation of all edit tools — every mutation starts
 * by finding the target node. Incorrect resolution means edits land on the
 * wrong element, so these tests verify all four reference types and error cases.
 */

import { resolveNode, requireSingleNode } from "../node-resolver";

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
