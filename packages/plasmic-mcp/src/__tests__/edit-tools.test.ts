/**
 * Unit tests for edit-tools.ts
 *
 * Edit tools are the bridge between user intent ("change this text") and model
 * mutations + persistence. Each tool must correctly:
 *   1. Resolve the target node from a human-readable reference
 *   2. Perform the mutation inside a recorded session (for incremental save)
 *   3. Handle error cases (wrong node type, missing node, cycle, root removal)
 *   4. Save the changes and return the new revision number
 *
 * Tests use the same mock patterns as save-manager.test.ts:
 *   - Plain objects with _type discriminators for model instances
 *   - mockWithRecording to control ChangeRecorder output
 *   - mockApiClient for save endpoint assertions
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  updateText,
  updateStyles,
  addChild,
  removeChild,
  moveChild,
  resolveVariant,
  listVariants,
  createStyleVariant,
  createVariantGroup,
  renameComponent,
  updatePageMeta,
  deleteComponent,
  sanitizeStyles,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
  mockRenameComponent,
  mockRemoveComponent,
  mockCreateStyleVariant,
  mockCreatePrivateStyleVariant,
  mockCreateVariantGroup,
  mockCreateVariant,
} from "../__mocks__/wab-tpl-mgr";
import { mockMkTplTagX, mockMkTplInlinedText, mockMkTplComponentX } from "../__mocks__/wab-tpls";
import { mockEnsureVariantSetting } from "../__mocks__/wab-variants";
import { mockUndoChanges } from "../__mocks__/wab-undo-util";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

// --- Test helpers ---

function mockApiClient() {
  return {
    saveRevision: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn(),
    getProjectBundle: vi.fn(),
    updateProject: vi.fn(),
  } as unknown as PlasmicApiClient & { saveRevision: ReturnType<typeof vi.fn> };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test",
    site: { components: [] },
    bundler: {
      fastBundle: mockFastBundle,
      addrOf: mockAddrOf,
      bundle: vi.fn().mockReturnValue({ map: {}, root: "0" }),
    },
    revisionNum: 10,
    modelVersion: 5,
    hostlessDataVersion: 2,
    projectUuid: "proj1",
    ...overrides,
  };
}

/** Build a TplTag node with optional children and text */
function mkTag(opts: {
  uuid?: string;
  name?: string;
  tag?: string;
  text?: string;
  children?: any[];
  styles?: Record<string, string>;
}): any {
  const vs: any = {
    rs: { values: { ...(opts.styles ?? {}) } },
  };
  if (opts.text !== undefined) {
    vs.text = { _type: "RawText", text: opts.text, markers: [] };
  }
  return {
    _type: "TplTag",
    uuid: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2, 8)}`,
    name: opts.name,
    tag: opts.tag ?? "div",
    vsettings: [vs],
    children: opts.children ?? [],
  };
}

/** Build a component with a tplTree */
function mkComponent(opts: {
  uuid?: string;
  name?: string;
  tplTree: any;
}): any {
  return {
    uuid: opts.uuid ?? "comp-uuid",
    name: opts.name ?? "TestComponent",
    tplTree: opts.tplTree,
    pageMeta: undefined,
  };
}

// =============================================================================
// sanitizeStyles — direct unit tests for CSS shorthand expansion
//
// sanitizeStyles is the gateway between user-supplied CSS and Plasmic's
// RuleSet model. Incorrect expansion causes site-invariant violations
// (Plasmic rejects shorthands) or silent data loss (dropped background
// longhands). These tests cover every expansion branch.
// =============================================================================

describe("sanitizeStyles", () => {
  // --- Padding shorthand ---

  it("expands padding with 1 value to all four longhands", () => {
    const result = sanitizeStyles({ padding: "10px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "10px",
      paddingBottom: "10px",
      paddingLeft: "10px",
    });
  });

  it("expands padding with 2 values (vertical horizontal)", () => {
    const result = sanitizeStyles({ padding: "10px 20px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "10px",
      paddingLeft: "20px",
    });
  });

  it("expands padding with 3 values (top horizontal bottom)", () => {
    const result = sanitizeStyles({ padding: "10px 20px 30px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "30px",
      paddingLeft: "20px",
    });
  });

  it("expands padding with 4 values (top right bottom left)", () => {
    const result = sanitizeStyles({ padding: "10px 20px 30px 40px" });
    expect(result).toEqual({
      paddingTop: "10px",
      paddingRight: "20px",
      paddingBottom: "30px",
      paddingLeft: "40px",
    });
  });

  it("accepts padding-shorthand alias", () => {
    const result = sanitizeStyles({ "padding-shorthand": "5px" });
    expect(result.paddingTop).toBe("5px");
    expect(result.paddingLeft).toBe("5px");
  });

  // --- Margin shorthand ---

  it("expands margin with 2 values", () => {
    const result = sanitizeStyles({ margin: "8px 16px" });
    expect(result).toEqual({
      marginTop: "8px",
      marginRight: "16px",
      marginBottom: "8px",
      marginLeft: "16px",
    });
  });

  it("accepts margin-shorthand alias", () => {
    const result = sanitizeStyles({ "margin-shorthand": "4px" });
    expect(result.marginTop).toBe("4px");
    expect(result.marginRight).toBe("4px");
  });

  // --- Gap shorthand ---

  it("expands gap with 1 value to row-gap and column-gap", () => {
    const result = sanitizeStyles({ gap: "12px" });
    expect(result).toEqual({
      "row-gap": "12px",
      "column-gap": "12px",
    });
  });

  it("expands gap with 2 values (row column)", () => {
    const result = sanitizeStyles({ gap: "10px 20px" });
    expect(result).toEqual({
      "row-gap": "10px",
      "column-gap": "20px",
    });
  });

  // --- Border-radius shorthand ---

  it("expands borderRadius with 1 value", () => {
    const result = sanitizeStyles({ borderRadius: "8px" });
    expect(result).toEqual({
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    });
  });

  it("expands border-radius kebab alias with 4 values", () => {
    const result = sanitizeStyles({ "border-radius": "4px 8px 12px 16px" });
    expect(result).toEqual({
      "border-top-left-radius": "4px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "12px",
      "border-bottom-left-radius": "16px",
    });
  });

  // --- Border-width shorthand ---

  it("expands borderWidth to side longhands", () => {
    const result = sanitizeStyles({ borderWidth: "1px 2px" });
    expect(result).toEqual({
      "border-top-width": "1px",
      "border-right-width": "2px",
      "border-bottom-width": "1px",
      "border-left-width": "2px",
    });
  });

  it("accepts border-width kebab alias", () => {
    const result = sanitizeStyles({ "border-width": "3px" });
    expect(result["border-top-width"]).toBe("3px");
    expect(result["border-left-width"]).toBe("3px");
  });

  // --- Border-style shorthand ---

  it("expands borderStyle to side longhands", () => {
    const result = sanitizeStyles({ borderStyle: "solid dashed" });
    expect(result).toEqual({
      "border-top-style": "solid",
      "border-right-style": "dashed",
      "border-bottom-style": "solid",
      "border-left-style": "dashed",
    });
  });

  it("accepts border-style kebab alias", () => {
    const result = sanitizeStyles({ "border-style": "dotted" });
    expect(result["border-top-style"]).toBe("dotted");
  });

  // --- Border-color shorthand ---

  it("expands borderColor to side longhands", () => {
    const result = sanitizeStyles({ borderColor: "red blue green yellow" });
    expect(result).toEqual({
      "border-top-color": "red",
      "border-right-color": "blue",
      "border-bottom-color": "green",
      "border-left-color": "yellow",
    });
  });

  it("accepts border-color kebab alias", () => {
    const result = sanitizeStyles({ "border-color": "#000" });
    expect(result["border-top-color"]).toBe("#000");
    expect(result["border-left-color"]).toBe("#000");
  });

  // --- Inset shorthand ---

  it("expands inset to top/right/bottom/left", () => {
    const result = sanitizeStyles({ inset: "0" });
    expect(result).toEqual({
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
    });
  });

  it("expands inset with 2 values", () => {
    const result = sanitizeStyles({ inset: "10px 20px" });
    expect(result).toEqual({
      top: "10px",
      right: "20px",
      bottom: "10px",
      left: "20px",
    });
  });

  // --- Background handling ---

  it("converts backgroundColor to linear-gradient background", () => {
    const result = sanitizeStyles({ backgroundColor: "#ff0000" });
    expect(result).toEqual({
      background: "linear-gradient(#ff0000, #ff0000)",
    });
  });

  it("accepts background-color kebab alias", () => {
    const result = sanitizeStyles({ "background-color": "blue" });
    expect(result).toEqual({
      background: "linear-gradient(blue, blue)",
    });
  });

  it("passes backgroundImage directly as background", () => {
    const result = sanitizeStyles({
      backgroundImage: "url(https://example.com/img.png)",
    });
    expect(result).toEqual({
      background: "url(https://example.com/img.png)",
    });
  });

  it("accepts background-image kebab alias", () => {
    const result = sanitizeStyles({
      "background-image": "url(test.png)",
    });
    expect(result).toEqual({ background: "url(test.png)" });
  });

  it("backgroundImage takes precedence over backgroundColor", () => {
    const result = sanitizeStyles({
      backgroundColor: "red",
      backgroundImage: "url(bg.png)",
    });
    // bgImage wins over bgColor in the post-loop consolidation
    expect(result).toEqual({ background: "url(bg.png)" });
  });

  it("explicit background shorthand overrides bgColor and bgImage", () => {
    const result = sanitizeStyles({
      backgroundColor: "red",
      backgroundImage: "url(bg.png)",
      background: "linear-gradient(blue, green)",
    });
    expect(result).toEqual({ background: "linear-gradient(blue, green)" });
  });

  it("drops unsupported background longhands and logs warning", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sanitizeStyles({
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      fontSize: "16px",
    });

    // Longhands are dropped, pass-through property preserved
    expect(result).toEqual({ fontSize: "16px" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dropped unsupported background longhands")
    );

    consoleSpy.mockRestore();
  });

  it("drops all background longhand variants (camel + kebab)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = sanitizeStyles({
      "background-size": "contain",
      "background-position": "top left",
      "background-repeat": "repeat-x",
      "background-attachment": "fixed",
      "background-origin": "padding-box",
      "background-clip": "border-box",
    });

    expect(Object.keys(result)).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // --- Pass-through and edge cases ---

  it("passes through unknown properties unchanged", () => {
    const result = sanitizeStyles({
      color: "red",
      fontSize: "16px",
      display: "flex",
      "--custom-var": "42px",
    });
    expect(result).toEqual({
      color: "red",
      fontSize: "16px",
      display: "flex",
      "--custom-var": "42px",
    });
  });

  it("returns empty object for empty input", () => {
    const result = sanitizeStyles({});
    expect(result).toEqual({});
  });

  it("handles multiple shorthands in a single call", () => {
    const result = sanitizeStyles({
      padding: "10px 20px",
      margin: "5px",
      gap: "8px",
      borderRadius: "4px",
      backgroundColor: "#fff",
    });

    expect(result.paddingTop).toBe("10px");
    expect(result.paddingRight).toBe("20px");
    expect(result.marginTop).toBe("5px");
    expect(result.marginLeft).toBe("5px");
    expect(result["row-gap"]).toBe("8px");
    expect(result["column-gap"]).toBe("8px");
    expect(result["border-top-left-radius"]).toBe("4px");
    expect(result.background).toBe("linear-gradient(#fff, #fff)");
  });
});

describe("edit-tools", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();

    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });

    // mockWithRecording returns empty changes by default
    mockWithRecording.mockReturnValue({
      changes: [],
      newInsts: [],
      removedInsts: [],
    });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  // Helper to set up session + change tracker with a component
  function setupSession(component: any) {
    const session = makeSession({
      site: { components: [component] },
    });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  // --- update-text ---

  describe("updateText", () => {
    it("updates existing RawText content", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Hero Title",
        text: "Old text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // ensureBaseVariantSetting returns the existing vsettings[0]
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      setupSession(comp);

      const result = await updateText(api, "comp-1", "Hero Title", "New text");

      expect(result.previousText).toBe("Old text");
      expect(result.newText).toBe("New text");
      expect(result.nodeName).toBe("Hero Title");
      expect(result.nodeUuid).toBe("text-1");
      expect(result.save.revisionNum).toBe(11);
      // The mutation callback updated the text
      expect(textNode.vsettings[0].text.text).toBe("New text");
    });

    it("creates new RawText when none exists", async () => {
      const node = mkTag({ uuid: "node-1", name: "Empty Node" });
      // No text set on this node
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(api, "comp-1", "Empty Node", "Brand new text");

      expect(result.previousText).toBeUndefined();
      expect(result.newText).toBe("Brand new text");
      // The vsettings[0].text should now be a RawText-like object
      expect(node.vsettings[0].text._type).toBe("RawText");
      expect(node.vsettings[0].text.text).toBe("Brand new text");
    });

    it("rejects update on a container node", async () => {
      const child = mkTag({ uuid: "child-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [child],
        styles: { flexDirection: "column" },
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "Section", "Should fail")
      ).rejects.toThrow("container");
    });

    it("rejects update on a non-TplTag node", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "SubComp",
        component: { name: "Other", uuid: "other-uuid" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "tpl-comp-1", "text")
      ).rejects.toThrow("not a TplTag");
    });

    it("throws when component UUID is not found", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updateText(api, "wrong-uuid", "root-1", "text")
      ).rejects.toThrow('Component UUID "wrong-uuid" not found');
    });

    it("throws when node reference is not found", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "nonexistent", "text")
      ).rejects.toThrow("not found");
    });

    it("resolves nodes by UUID", async () => {
      const textNode = mkTag({ uuid: "exact-uuid-123", text: "Hello" });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateText(api, "comp-1", "exact-uuid-123", "Updated");
      expect(result.nodeUuid).toBe("exact-uuid-123");
    });
  });

  // --- update-styles ---

  describe("updateStyles", () => {
    it("sets style properties via RSH merge", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      const result = await updateStyles(api, "comp-1", "Box", {
        fontSize: "24px",
        backgroundColor: "#ff0000",
      });

      expect(result.updatedProperties).toEqual(["fontSize", "background"]);
      expect(result.nodeName).toBe("Box");
      expect(result.save.revisionNum).toBe(11);
      // RSH mock actually mutates rs.values
      expect(node.vsettings[0].rs.values.fontSize).toBe("24px");
      // backgroundColor is sanitized to a background gradient shorthand
      expect(node.vsettings[0].rs.values.background).toBe(
        "linear-gradient(#ff0000, #ff0000)"
      );
      // Existing style preserved
      expect(node.vsettings[0].rs.values.color).toBe("red");
    });

    it("rejects style update on non-TplTag", async () => {
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "Sub",
        component: { name: "Other", uuid: "other-uuid" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [compNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        updateStyles(api, "comp-1", "tpl-comp-1", { color: "blue" })
      ).rejects.toThrow("not a TplTag");
    });

    it("saves with correct modifiedComponentIids", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-42" });
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "green" });

      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({
          modifiedComponentIids: ["comp-iid-42"],
        })
      );
    });
  });

  // --- add-child ---

  describe("addChild", () => {
    it("adds a text child at default position (last)", async () => {
      const existingChild = mkTag({ uuid: "existing-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [existingChild],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Text elements use mkTplInlinedText, not mkTplTagX
      const newTpl = mkTag({ uuid: "new-child-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      const result = await addChild(
        api,
        "comp-1",
        "Section",
        { type: "text", value: "Hello World" }
      );

      expect(result.parentName).toBe("Section");
      expect(result.position).toBe("last");
      expect(result.save.revisionNum).toBe(11);
      // Child was appended
      expect(container.children.length).toBe(2);
      expect(container.children[1]).toBe(newTpl);
    });

    it("inserts child at 'first' position", async () => {
      const existingChild = mkTag({ uuid: "existing-1" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [existingChild],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-child-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(
        api,
        "comp-1",
        "Section",
        { type: "box", children: [] },
        "first"
      );

      expect(container.children[0]).toBe(newTpl);
      expect(container.children[1]).toBe(existingChild);
    });

    it("inserts child at numeric index", async () => {
      const child1 = mkTag({ uuid: "child-1" });
      const child2 = mkTag({ uuid: "child-2" });
      const container = mkTag({
        uuid: "container-1",
        name: "Section",
        children: [child1, child2],
      });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-child-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(api, "comp-1", "Section", { type: "box" }, 1);

      expect(container.children[0]).toBe(child1);
      expect(container.children[1]).toBe(newTpl);
      expect(container.children[2]).toBe(child2);
    });

    it("rejects adding children to a text node", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Hello",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        addChild(api, "comp-1", "Title", { type: "text", value: "Extra" })
      ).rejects.toThrow("text element and cannot have children");
    });

    it("calls mkTplTagX with correct tag for element types", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const newTpl = mkTag({ uuid: "new-1" });
      mockMkTplTagX.mockReturnValue(newTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      setupSession(comp);

      await addChild(api, "comp-1", "Section", {
        type: "img",
        src: "https://example.com/img.png",
      });

      expect(mockMkTplTagX).toHaveBeenCalledWith(
        "img",
        { baseVariant: undefined, styles: {} }
      );
    });
  });

  // --- add-child with component instances ---

  describe("addChild with component instances", () => {
    /** Build a TplComponent-like node (as returned by mkTplComponentX mock) */
    function mkTplComponent(opts: {
      uuid?: string;
      name?: string;
      componentName: string;
      componentUuid: string;
    }): any {
      return {
        _type: "TplComponent",
        uuid: opts.uuid ?? `tpl-comp-${Math.random().toString(36).slice(2, 8)}`,
        name: opts.name ?? null,
        component: { name: opts.componentName, uuid: opts.componentUuid },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
    }

    it("creates a TplComponent when type is 'component'", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });

      // The component being EDITED (owning component)
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // The component being REFERENCED (added as an instance)
      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-1",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      // Session must include BOTH the owning component and the referenced component
      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
      });

      expect(result.parentName).toBe("Section");
      expect(result.newNodeUuid).toBe("new-tpl-comp-1");
      expect(result.save.revisionNum).toBe(11);

      // Verify mkTplComponentX was called with the correct component
      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: cardComp,
        })
      );

      // Verify the TplComponent was inserted into the container
      expect(container.children.length).toBe(1);
      expect(container.children[0]).toBe(newTplComp);
    });

    it("resolves component by UUID when name doesn't match", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const headerComp = {
        uuid: "header-uuid-123",
        name: "Header",
        tplTree: mkTag({ uuid: "header-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-2",
        componentName: "Header",
        componentUuid: "header-uuid-123",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, headerComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      // Reference by UUID instead of name
      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "header-uuid-123",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: headerComp,
        })
      );
    });

    it("throws descriptive error when component name is not found", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({
        uuid: "comp-1",
        name: "Page",
        tplTree: root,
      });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "NonExistent",
        })
      ).rejects.toThrow('Component "NonExistent" not found');

      // Error should list available component names
      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "NonExistent",
        })
      ).rejects.toThrow("Card");
    });

    it("handles type 'default-component' using kind field", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-3",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "default-component",
        kind: "Button",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: buttonComp,
        })
      );
      expect(container.children[0]).toBe(newTplComp);
    });

    it("passes children to mkTplComponentX for slot wiring", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [{ variable: { name: "children" } }],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-4",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);

      // mkTplInlinedText is called for the string child inside the component
      const childTpl = mkTag({ uuid: "child-text-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(childTpl);

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
        children: [{ type: "text", value: "Card content" }],
      });

      // mkTplComponentX should be called with children array
      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: cardComp,
          children: [childTpl],
        })
      );
    });

    it("finds component from dependency projects", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Component only exists in a dependency, not locally
      const depComp = {
        uuid: "dep-comp-uuid",
        name: "DepButton",
        tplTree: mkTag({ uuid: "dep-button-root" }),
        params: [],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-comp-5",
        componentName: "DepButton",
        componentUuid: "dep-comp-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: {
          components: [owningComp],
          projectDependencies: [
            { site: { components: [depComp] } },
          ],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "DepButton",
      });

      expect(mockMkTplComponentX).toHaveBeenCalledWith(
        expect.objectContaining({
          component: depComp,
        })
      );
    });
  });

  // --- add-child with component props ---
  //
  // The "props" field on ComponentElement allows setting non-slot prop
  // overrides on component instances. Each prop value is converted to a
  // CustomCode expression and passed as args to mkTplComponentX. This
  // enables richer component composition (e.g., { type: "component",
  // name: "Button", props: { label: "Click me", disabled: true } }).

  describe("addChild with component props", () => {
    /** Build a TplComponent-like node (as returned by mkTplComponentX mock) */
    function mkTplComponent(opts: {
      uuid?: string;
      componentName: string;
      componentUuid: string;
    }): any {
      return {
        _type: "TplComponent",
        uuid: opts.uuid ?? `tpl-comp-${Math.random().toString(36).slice(2, 8)}`,
        name: null,
        component: { name: opts.componentName, uuid: opts.componentUuid },
        vsettings: [{ rs: { values: {} }, args: [] }],
        children: [],
      };
    }

    it("passes props as args dict to mkTplComponentX", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [
          { variable: { name: "label" } },
          { variable: { name: "disabled" } },
          { variable: { name: "count" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-1",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Button",
        props: { label: "Click me", disabled: true, count: 42 },
      });

      // mkTplComponentX should receive an args dict with CustomCode values
      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.component).toBe(buttonComp);
      expect(callArgs.args).toBeDefined();
      expect(callArgs.args.label._type).toBe("CustomCode");
      expect(callArgs.args.label.code).toBe('"Click me"');
      expect(callArgs.args.disabled._type).toBe("CustomCode");
      expect(callArgs.args.disabled.code).toBe("true");
      expect(callArgs.args.count._type).toBe("CustomCode");
      expect(callArgs.args.count.code).toBe("42");
    });

    it("passes both props and children together", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [
          { variable: { name: "title" } },
          { variable: { name: "children" }, tplSlot: {} }, // slot param
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-2",
        componentName: "Card",
        componentUuid: "card-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      const childTpl = mkTag({ uuid: "child-text-1", tag: "div" });
      mockMkTplInlinedText.mockReturnValue(childTpl);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Card",
        props: { title: "My Card" },
        children: [{ type: "text", value: "Card body" }],
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args.title._type).toBe("CustomCode");
      expect(callArgs.args.title.code).toBe('"My Card"');
      expect(callArgs.children).toEqual([childTpl]);
    });

    it("handles null and array prop values", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const widgetComp = {
        uuid: "widget-uuid",
        name: "Widget",
        tplTree: mkTag({ uuid: "widget-root" }),
        params: [
          { variable: { name: "items" } },
          { variable: { name: "fallback" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-3",
        componentName: "Widget",
        componentUuid: "widget-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, widgetComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Widget",
        props: { items: ["a", "b"], fallback: null },
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args.items.code).toBe('["a","b"]');
      expect(callArgs.args.fallback.code).toBe("null");
    });

    it("throws error for unknown prop name", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [{ variable: { name: "label" } }],
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "Button",
          props: { nonExistent: "value" },
        })
      ).rejects.toThrow('Unknown prop "nonExistent" on component "Button"');
    });

    it("throws error when prop targets a slot param", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const cardComp = {
        uuid: "card-uuid",
        name: "Card",
        tplTree: mkTag({ uuid: "card-root" }),
        params: [
          { variable: { name: "children" }, tplSlot: { name: "children" } },
        ],
      };

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, cardComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        addChild(api, "comp-1", "Section", {
          type: "component",
          name: "Card",
          props: { children: "some text" },
        })
      ).rejects.toThrow('Prop "children" is a slot on component "Card"');
    });

    it("skips args when props is empty object", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const buttonComp = {
        uuid: "button-uuid",
        name: "Button",
        tplTree: mkTag({ uuid: "button-root" }),
        params: [{ variable: { name: "label" } }],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-6",
        componentName: "Button",
        componentUuid: "button-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, buttonComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "component",
        name: "Button",
        props: {},
      });

      // Empty props should NOT produce an args field
      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.args).toBeUndefined();
    });

    it("works with default-component type and props", async () => {
      const container = mkTag({ uuid: "container-1", name: "Section" });
      const root = mkTag({ uuid: "root-1", children: [container] });
      const owningComp = mkComponent({ uuid: "comp-1", tplTree: root });

      const inputComp = {
        uuid: "input-uuid",
        name: "TextInput",
        tplTree: mkTag({ uuid: "input-root" }),
        params: [
          { variable: { name: "placeholder" } },
          { variable: { name: "required" } },
        ],
      };

      const newTplComp = mkTplComponent({
        uuid: "new-tpl-props-7",
        componentName: "TextInput",
        componentUuid: "input-uuid",
      });
      mockMkTplComponentX.mockReturnValue(newTplComp);
      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => {
        if (!tpl.vsettings || tpl.vsettings.length === 0) {
          tpl.vsettings = [{ rs: { values: {} } }];
        }
        return tpl.vsettings[0];
      });

      const session = makeSession({
        site: { components: [owningComp, inputComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await addChild(api, "comp-1", "Section", {
        type: "default-component",
        kind: "TextInput",
        props: { placeholder: "Enter text...", required: true },
      });

      const callArgs = mockMkTplComponentX.mock.calls[0][0];
      expect(callArgs.component).toBe(inputComp);
      expect(callArgs.args.placeholder.code).toBe('"Enter text..."');
      expect(callArgs.args.required.code).toBe("true");
    });
  });

  // --- remove-child ---

  describe("removeChild", () => {
    it("removes a child node from its parent", async () => {
      const child = mkTag({ uuid: "child-1", name: "ToRemove" });
      const root = mkTag({
        uuid: "root-1",
        name: "Root",
        children: [child],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      const result = await removeChild(api, "comp-1", "ToRemove");

      expect(result.removedName).toBe("ToRemove");
      expect(result.removedUuid).toBe("child-1");
      expect(result.save.revisionNum).toBe(11);
      expect(root.children.length).toBe(0);
    });

    it("removes the correct child when multiple exist", async () => {
      const child1 = mkTag({ uuid: "child-1", name: "First" });
      const child2 = mkTag({ uuid: "child-2", name: "Second" });
      const child3 = mkTag({ uuid: "child-3", name: "Third" });
      const root = mkTag({
        uuid: "root-1",
        children: [child1, child2, child3],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await removeChild(api, "comp-1", "child-2");

      expect(root.children).toEqual([child1, child3]);
    });

    it("prevents removal of root node", async () => {
      const root = mkTag({ uuid: "root-1", name: "Root" });
      const comp = mkComponent({
        uuid: "comp-1",
        name: "MyComp",
        tplTree: root,
      });

      setupSession(comp);

      await expect(
        removeChild(api, "comp-1", "root-1")
      ).rejects.toThrow('Cannot remove the root node of component "MyComp"');
    });

    it("removes deeply nested children", async () => {
      const deepChild = mkTag({ uuid: "deep-1", name: "DeepChild" });
      const middle = mkTag({
        uuid: "mid-1",
        children: [deepChild],
      });
      const root = mkTag({ uuid: "root-1", children: [middle] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await removeChild(api, "comp-1", "DeepChild");

      expect(middle.children.length).toBe(0);
    });
  });

  // --- move-child ---

  describe("moveChild", () => {
    it("moves a node from one parent to another", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      const result = await moveChild(
        api,
        "comp-1",
        "Movable",
        "Target"
      );

      expect(result.movedName).toBe("Movable");
      expect(result.newParentName).toBe("Target");
      expect(result.position).toBe("last");
      expect(source.children.length).toBe(0);
      expect(target.children).toContain(movable);
    });

    it("moves to 'first' position in new parent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const existing = mkTag({ uuid: "existing-1" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [existing],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await moveChild(api, "comp-1", "Movable", "Target", "first");

      expect(target.children[0]).toBe(movable);
      expect(target.children[1]).toBe(existing);
    });

    it("detects and prevents cycles", async () => {
      const innerChild = mkTag({ uuid: "inner-1", name: "Inner" });
      const outerParent = mkTag({
        uuid: "outer-1",
        name: "Outer",
        children: [innerChild],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [outerParent],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      // Try to move Outer into its own descendant Inner
      await expect(
        moveChild(api, "comp-1", "Outer", "Inner")
      ).rejects.toThrow('Cannot move "Outer" into its own descendant "Inner"');
    });

    it("prevents moving the root node", async () => {
      const target = mkTag({ uuid: "target-1", name: "Target" });
      const root = mkTag({
        uuid: "root-1",
        name: "Root",
        children: [target],
      });
      const comp = mkComponent({
        uuid: "comp-1",
        name: "MyComp",
        tplTree: root,
      });

      setupSession(comp);

      await expect(
        moveChild(api, "comp-1", "root-1", "Target")
      ).rejects.toThrow("Cannot move the root node");
    });

    it("rejects move to non-TplTag parent", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const compNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "CompTarget",
        component: { name: "Other", uuid: "other" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({
        uuid: "root-1",
        children: [movable, compNode],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await expect(
        moveChild(api, "comp-1", "Movable", "tpl-comp-1")
      ).rejects.toThrow("not a TplTag");
    });

    it("moves to numeric position", async () => {
      const movable = mkTag({ uuid: "movable-1", name: "Movable" });
      const child1 = mkTag({ uuid: "child-1" });
      const child2 = mkTag({ uuid: "child-2" });
      const source = mkTag({
        uuid: "source-1",
        name: "Source",
        children: [movable],
      });
      const target = mkTag({
        uuid: "target-1",
        name: "Target",
        children: [child1, child2],
      });
      const root = mkTag({
        uuid: "root-1",
        children: [source, target],
      });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      setupSession(comp);

      await moveChild(api, "comp-1", "Movable", "Target", 1);

      expect(target.children[0]).toBe(child1);
      expect(target.children[1]).toBe(movable);
      expect(target.children[2]).toBe(child2);
    });
  });

  // --- Variant resolution ---

  describe("resolveVariant", () => {
    /** Build a site with global variant groups */
    function mkSite(opts?: {
      globalVariantGroups?: any[];
    }): any {
      return {
        globalVariantGroups: opts?.globalVariantGroups ?? [],
        components: [],
      };
    }

    /** Build a variant object */
    function mkVariant(opts: {
      uuid?: string;
      name?: string;
      selectors?: string[];
      forTpl?: any;
      parent?: any;
    }): any {
      return {
        uuid: opts.uuid ?? `var-${Math.random().toString(36).slice(2, 8)}`,
        name: opts.name ?? "unnamed",
        selectors: opts.selectors ?? null,
        forTpl: opts.forTpl ?? null,
        parent: opts.parent ?? null,
      };
    }

    it("resolves a variant by UUID from global groups", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [{ uuid: "base-uuid", name: "base" }] };

      const result = resolveVariant(site, comp, "mobile-uuid");
      expect(result).toBe(mobile);
    });

    it("resolves a variant by UUID from component groups", () => {
      const small = mkVariant({ uuid: "small-uuid", name: "Small" });
      const site = mkSite();
      const comp = {
        variantGroups: [{
          uuid: "size-group",
          param: { variable: { name: "Size" } },
          variants: [small],
        }],
        variants: [{ uuid: "base-uuid", name: "base" }],
      };

      const result = resolveVariant(site, comp, "small-uuid");
      expect(result).toBe(small);
    });

    it("resolves a variant by name (case-insensitive)", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [] };

      const result = resolveVariant(site, comp, "mobile");
      expect(result).toBe(mobile);
    });

    it("resolves a style variant by selector", () => {
      const hover = mkVariant({
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
      });
      const site = mkSite();
      const comp = {
        variantGroups: [],
        variants: [{ uuid: "base-uuid", name: "base" }, hover],
      };

      const result = resolveVariant(site, comp, ":hover");
      expect(result).toBe(hover);
    });

    it("throws descriptive error when variant not found", () => {
      const mobile = mkVariant({ uuid: "mobile-uuid", name: "Mobile" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [mobile],
        }],
      });
      const comp = { variantGroups: [], variants: [] };

      expect(() => resolveVariant(site, comp, "Tablet")).toThrow(
        'Variant "Tablet" not found'
      );
      expect(() => resolveVariant(site, comp, "Tablet")).toThrow("Mobile");
    });

    it("throws ambiguity error when name matches multiple variants", () => {
      const globalDark = mkVariant({ uuid: "global-dark", name: "Dark" });
      const compDark = mkVariant({ uuid: "comp-dark", name: "Dark" });
      const site = mkSite({
        globalVariantGroups: [{
          uuid: "theme-group",
          type: "global-user-defined",
          param: { variable: { name: "Theme" } },
          variants: [globalDark],
        }],
      });
      const comp = {
        variantGroups: [{
          uuid: "comp-theme-group",
          param: { variable: { name: "CompTheme" } },
          variants: [compDark],
        }],
        variants: [],
      };

      expect(() => resolveVariant(site, comp, "Dark")).toThrow("Ambiguous");
      expect(() => resolveVariant(site, comp, "Dark")).toThrow("global-dark");
      expect(() => resolveVariant(site, comp, "Dark")).toThrow("comp-dark");
    });

    it("throws error for missing selector variant", () => {
      const site = mkSite();
      const comp = { variantGroups: [], variants: [] };

      expect(() => resolveVariant(site, comp, ":focus")).toThrow(
        "No :focus variant found"
      );
    });

    it("resolves variant by UUID from component.variants array", () => {
      const styleVariant = mkVariant({
        uuid: "style-var-uuid",
        name: "pressed",
        selectors: [":active"],
      });
      const site = mkSite();
      const comp = {
        variantGroups: [],
        variants: [{ uuid: "base-uuid", name: "base" }, styleVariant],
      };

      const result = resolveVariant(site, comp, "style-var-uuid");
      expect(result).toBe(styleVariant);
    });
  });

  // --- list-variants ---

  describe("listVariants", () => {
    it("returns global screen variants with mediaQuery", () => {
      const site = {
        globalVariantGroups: [{
          uuid: "screen-group",
          type: "global-screen",
          param: { variable: { name: "Screen" } },
          variants: [
            { uuid: "mobile-uuid", name: "Mobile", mediaQuery: "(max-width: 768px)" },
            { uuid: "tablet-uuid", name: "Tablet", mediaQuery: "(max-width: 1024px)" },
          ],
        }],
      };
      const comp = { variantGroups: [], variants: [] };

      const result = listVariants(site, comp);

      expect(result.globalVariants).toHaveLength(1);
      expect(result.globalVariants[0].group).toBe("Screen");
      expect(result.globalVariants[0].type).toBe("global-screen");
      expect(result.globalVariants[0].variants).toEqual([
        { uuid: "mobile-uuid", name: "Mobile", mediaQuery: "(max-width: 768px)" },
        { uuid: "tablet-uuid", name: "Tablet", mediaQuery: "(max-width: 1024px)" },
      ]);
    });

    it("returns component variant groups", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "size-group",
          param: { variable: { name: "Size" } },
          variants: [
            { uuid: "small-uuid", name: "Small" },
            { uuid: "large-uuid", name: "Large" },
          ],
        }],
        variants: [],
      };

      const result = listVariants(site, comp);

      expect(result.componentVariants).toHaveLength(1);
      expect(result.componentVariants[0].group).toBe("Size");
      expect(result.componentVariants[0].variants).toEqual([
        { uuid: "small-uuid", name: "Small" },
        { uuid: "large-uuid", name: "Large" },
      ]);
    });

    it("separates style variants from regular component variants", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "mixed-group",
          param: { variable: { name: "Interaction" } },
          variants: [
            { uuid: "hover-uuid", name: "hover", selectors: [":hover"], forTpl: { uuid: "node-1" } },
            { uuid: "size-uuid", name: "Large" },
          ],
        }],
        variants: [],
      };

      const result = listVariants(site, comp);

      expect(result.componentVariants).toHaveLength(1);
      expect(result.componentVariants[0].variants).toEqual([
        { uuid: "size-uuid", name: "Large" },
      ]);
      expect(result.styleVariants).toHaveLength(1);
      expect(result.styleVariants[0]).toEqual({
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
        forTpl: "node-1",
      });
    });

    it("picks up style variants from component.variants array", () => {
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [],
        variants: [
          { uuid: "base", name: "base" },
          { uuid: "focus-uuid", name: "focus", selectors: [":focus"] },
        ],
      };

      const result = listVariants(site, comp);

      expect(result.styleVariants).toHaveLength(1);
      expect(result.styleVariants[0].uuid).toBe("focus-uuid");
      expect(result.styleVariants[0].selectors).toEqual([":focus"]);
    });

    it("returns empty arrays when no variants exist", () => {
      const site = { globalVariantGroups: [] };
      const comp = { variantGroups: [], variants: [] };

      const result = listVariants(site, comp);

      expect(result.globalVariants).toEqual([]);
      expect(result.componentVariants).toEqual([]);
      expect(result.styleVariants).toEqual([]);
    });

    it("does not duplicate style variants found in both variantGroups and variants", () => {
      const hoverVariant = {
        uuid: "hover-uuid",
        name: "hover",
        selectors: [":hover"],
      };
      const site = { globalVariantGroups: [] };
      const comp = {
        variantGroups: [{
          uuid: "group-1",
          param: { variable: { name: "Interaction" } },
          variants: [hoverVariant],
        }],
        // Same variant also in the flat variants array
        variants: [hoverVariant],
      };

      const result = listVariants(site, comp);
      expect(result.styleVariants).toHaveLength(1);
    });
  });

  // --- Variant-aware editing ---

  describe("variant-aware updateStyles", () => {
    it("targets the base variant when variant is omitted (backward compatible)", async () => {
      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { fontSize: "24px" });

      // Should call base variant setting, not ensureVariantSetting
      expect(mockEnsureBaseVariantSetting).toHaveBeenCalled();
      expect(mockEnsureVariantSetting).not.toHaveBeenCalled();
    });

    it("targets a specific variant when variant param is provided", async () => {
      const mobileVariant = {
        uuid: "mobile-uuid",
        name: "Mobile",
        mediaQuery: "(max-width: 768px)",
      };
      const mobileVs = { rs: { values: {} }, variants: [mobileVariant] };

      const node = mkTag({
        uuid: "styled-1",
        name: "Box",
        styles: { color: "red" },
      });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      // Add variant groups to the session's site
      const session = makeSession({
        site: {
          components: [comp],
          globalVariantGroups: [{
            uuid: "screen-group",
            type: "global-screen",
            param: { variable: { name: "Screen" } },
            variants: [mobileVariant],
          }],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      mockEnsureVariantSetting.mockReturnValue(mobileVs);

      await updateStyles(api, "comp-1", "Box", { fontSize: "14px" }, "Mobile");

      // Should call ensureVariantSetting with the mobile variant
      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(
        node,
        [mobileVariant]
      );
      // Should have set the style on the mobile VS
      expect(mobileVs.rs.values).toHaveProperty("fontSize", "14px");
    });
  });

  describe("variant-aware updateText", () => {
    it("targets the base variant when variant is omitted (backward compatible)", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateText(api, "comp-1", "Title", "New text");

      expect(mockEnsureBaseVariantSetting).toHaveBeenCalled();
      expect(mockEnsureVariantSetting).not.toHaveBeenCalled();
      expect(textNode.vsettings[0].text.text).toBe("New text");
    });

    it("targets a specific variant when variant param is provided", async () => {
      const mobileVariant = {
        uuid: "mobile-uuid",
        name: "Mobile",
      };
      const mobileVs = {
        rs: { values: {} },
        variants: [mobileVariant],
        text: { _type: "RawText", text: "Mobile text", markers: [] },
      };

      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      const session = makeSession({
        site: {
          components: [comp],
          globalVariantGroups: [{
            uuid: "screen-group",
            type: "global-screen",
            param: { variable: { name: "Screen" } },
            variants: [mobileVariant],
          }],
        },
      });
      setSession(session);
      initChangeTracker(session.site);

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockEnsureVariantSetting.mockReturnValue(mobileVs);

      const result = await updateText(api, "comp-1", "Title", "Mobile title", "Mobile");

      expect(mockEnsureVariantSetting).toHaveBeenCalledWith(
        textNode,
        [mobileVariant]
      );
      expect(result.previousText).toBe("Mobile text");
      expect(result.newText).toBe("Mobile title");
      expect(mobileVs.text.text).toBe("Mobile title");
      // Base variant text should be unchanged
      expect(textNode.vsettings[0].text.text).toBe("Base text");
    });

    it("throws variant not found error with helpful message", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Base text",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await expect(
        updateText(api, "comp-1", "Title", "text", "NonExistent")
      ).rejects.toThrow('Variant "NonExistent" not found');
    });
  });

  // --- Integration-level behaviors ---

  describe("save integration", () => {
    it("calls saveRevision after successful mutation", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(api.saveRevision).toHaveBeenCalledWith(
        "proj1",
        11,
        expect.objectContaining({ incremental: true })
      );
    });

    it("increments session revision after save", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      const session = setupSession(comp);

      await updateStyles(api, "comp-1", "Box", { color: "red" });

      expect(session.revisionNum).toBe(11);
    });
  });

  // --- rename-component ---

  describe("renameComponent", () => {
    it("calls TplMgr.renameComponent with the new name", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "OldName", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewName");

      expect(mockRenameComponent).toHaveBeenCalledWith(comp, "NewName");
      expect(result.oldName).toBe("OldName");
      expect(result.newName).toBe("NewName");
      expect(result.componentUuid).toBe("comp-1");
    });

    it("updates page path when newPath is provided", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = {
        ...mkComponent({ uuid: "page-1", name: "HomePage", tplTree: root }),
        pageMeta: { path: "/old" },
      };
      setupSession(comp);

      const result = await renameComponent(api, "page-1", "LandingPage", "/landing");

      expect(comp.pageMeta.path).toBe("/landing");
      expect(result.newPath).toBe("/landing");
    });

    it("does not update path when component is not a page", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewCard", "/some-path");

      // newPath is ignored because component has no pageMeta
      expect(result.newPath).toBeUndefined();
    });

    it("saves the changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const result = await renameComponent(api, "comp-1", "NewCard");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        renameComponent(api, "nonexistent", "Foo")
      ).rejects.toThrow("not found");
    });

    it("returns deduplicated name from TplMgr", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Original", tplTree: root });
      setupSession(comp);

      // Simulate TplMgr deduplication: renameComponent changes name to "Card 2"
      mockRenameComponent.mockImplementation((c: any, name: string) => {
        c.name = name + " 2";
      });

      const result = await renameComponent(api, "comp-1", "Card");

      expect(result.oldName).toBe("Original");
      expect(result.newName).toBe("Card 2");
    });
  });

  // --- update-page-meta ---

  describe("updatePageMeta", () => {
    function mkPageComponent(uuid: string, name: string, pageMeta: any) {
      const root = mkTag({ uuid: `${uuid}-root` });
      return {
        ...mkComponent({ uuid, name, tplTree: root }),
        pageMeta,
      };
    }

    it("updates title and description", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
        description: "",
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", {
        title: "Welcome",
        description: "Landing page",
      });

      expect(comp.pageMeta.title).toBe("Welcome");
      expect(comp.pageMeta.description).toBe("Landing page");
      expect(result.updatedFields).toEqual(["title", "description"]);
      expect(result.componentName).toBe("HomePage");
    });

    it("updates all metadata fields at once", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
        description: "",
        openGraphImage: null,
        canonical: null,
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", {
        title: "My Site",
        description: "Description",
        openGraphImage: "https://example.com/og.png",
        canonical: "https://example.com/",
        path: "/welcome",
      });

      expect(result.updatedFields).toHaveLength(5);
      expect(comp.pageMeta.path).toBe("/welcome");
      expect(comp.pageMeta.openGraphImage).toBe("https://example.com/og.png");
    });

    it("only updates provided fields, leaves others unchanged", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: "Old Title",
        description: "Old Description",
      });
      setupSession(comp);

      await updatePageMeta(api, "page-1", { title: "New Title" });

      expect(comp.pageMeta.title).toBe("New Title");
      expect(comp.pageMeta.description).toBe("Old Description"); // unchanged
    });

    it("throws when component is not a page", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Header", tplTree: root });
      setupSession(comp);

      await expect(
        updatePageMeta(api, "comp-1", { title: "Fail" })
      ).rejects.toThrow("not a page");
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        updatePageMeta(api, "nonexistent", { title: "Fail" })
      ).rejects.toThrow("not found");
    });

    it("saves the changes to the server", async () => {
      const comp = mkPageComponent("page-1", "HomePage", {
        path: "/",
        title: null,
      });
      setupSession(comp);

      const result = await updatePageMeta(api, "page-1", { title: "New" });

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });
  });

  // --- delete-component ---

  describe("deleteComponent", () => {
    it("deletes a component with no references", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "OldCard", tplTree: root });

      // Set up session with the component to delete (no other components reference it)
      const session = makeSession({
        site: { components: [comp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await deleteComponent(api, "comp-1");

      expect(mockRemoveComponent).toHaveBeenCalledWith(comp);
      expect(result.deletedName).toBe("OldCard");
      expect(result.deletedUuid).toBe("comp-1");
    });

    it("throws when references exist and force is not set", async () => {
      const root = mkTag({ uuid: "root-1" });
      const cardComp = mkComponent({ uuid: "comp-card", name: "Card", tplTree: root });

      // Create a component that references Card via a TplComponent node
      const tplCompNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        component: cardComp,
        vsettings: [],
        children: [],
      };
      const pageRoot = mkTag({ uuid: "root-2", children: [tplCompNode] });
      const pageComp = mkComponent({ uuid: "comp-page", name: "HomePage", tplTree: pageRoot });

      const session = makeSession({
        site: { components: [cardComp, pageComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      await expect(
        deleteComponent(api, "comp-card")
      ).rejects.toThrow("referenced by HomePage");
    });

    it("deletes when force is true despite references", async () => {
      const root = mkTag({ uuid: "root-1" });
      const cardComp = mkComponent({ uuid: "comp-card", name: "Card", tplTree: root });

      const tplCompNode = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        component: cardComp,
        vsettings: [],
        children: [],
      };
      const pageRoot = mkTag({ uuid: "root-2", children: [tplCompNode] });
      const pageComp = mkComponent({ uuid: "comp-page", name: "HomePage", tplTree: pageRoot });

      const session = makeSession({
        site: { components: [cardComp, pageComp] },
      });
      setSession(session);
      initChangeTracker(session.site);

      const result = await deleteComponent(api, "comp-card", true);

      expect(mockRemoveComponent).toHaveBeenCalledWith(cardComp);
      expect(result.deletedName).toBe("Card");
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        deleteComponent(api, "nonexistent")
      ).rejects.toThrow("not found");
    });

    it("saves the changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "ToDelete", tplTree: root });
      setupSession(comp);

      const result = await deleteComponent(api, "comp-1");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });
  });

  // --- createStyleVariant ---

  describe("createStyleVariant", () => {
    it("creates a component-level :hover variant", async () => {
      const root = mkTag({ uuid: "root-1", name: "Root" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      // No existing style variants
      (comp as any).variants = [{ name: "base", uuid: "base-uuid" }];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: null };
      mockCreateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover");

      expect(mockCreateStyleVariant).toHaveBeenCalledWith(comp, [":hover"]);
      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.selector).toBe(":hover");
      expect(result.scope).toBe("component");
      expect(result.forTplUuid).toBeUndefined();
    });

    it("creates an element-scoped :hover variant when nodeRef is provided", async () => {
      const textNode = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [{ name: "base", uuid: "base-uuid" }];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: textNode };
      mockCreatePrivateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover", "Heading");

      expect(mockCreatePrivateStyleVariant).toHaveBeenCalledWith(comp, textNode, [":hover"]);
      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.selector).toBe(":hover");
      expect(result.scope).toBe("element");
      expect(result.forTplUuid).toBe("text-1");
      expect(result.forTplName).toBe("Heading");
    });

    it("rejects invalid selectors", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":invalid-selector")
      ).rejects.toThrow("Invalid selector");
    });

    it("rejects duplicate component-level style variant", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: null },
      ];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover")
      ).rejects.toThrow("already exists for this component");
    });

    it("rejects duplicate element-scoped style variant", async () => {
      const textNode = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: textNode },
      ];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover", "Heading")
      ).rejects.toThrow("already exists for this element");
    });

    it("allows same selector on different elements", async () => {
      const heading = mkTag({ uuid: "text-1", name: "Heading", text: "Hello" });
      const subtitle = mkTag({ uuid: "text-2", name: "Subtitle", text: "World" });
      const root = mkTag({ uuid: "root-1", name: "Root", children: [heading, subtitle] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      // existing hover on heading, but not on subtitle
      (comp as any).variants = [
        { name: "base", uuid: "base-uuid" },
        { uuid: "existing-hover", selectors: [":hover"], forTpl: heading },
      ];
      setupSession(comp);

      const mockVariant = { uuid: "new-hover-uuid", selectors: [":hover"], forTpl: subtitle };
      mockCreatePrivateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover", "Subtitle");

      expect(result.variantUuid).toBe("new-hover-uuid");
      expect(result.scope).toBe("element");
      expect(result.forTplName).toBe("Subtitle");
    });

    it("rejects nodeRef targeting a non-TplTag", async () => {
      const tplComp = {
        _type: "TplComponent",
        uuid: "tpl-comp-1",
        name: "MyComp",
        component: { name: "Inner" },
        vsettings: [],
        children: [],
      };
      const root = mkTag({ uuid: "root-1", children: [tplComp] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [];
      setupSession(comp);

      await expect(
        createStyleVariant(api, "comp-1", ":hover", "tpl-comp-1")
      ).rejects.toThrow("not a TplTag");
    });

    it("saves changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      (comp as any).variants = [];
      setupSession(comp);

      const mockVariant = { uuid: "hover-uuid", selectors: [":hover"], forTpl: null };
      mockCreateStyleVariant.mockReturnValue(mockVariant);

      const result = await createStyleVariant(api, "comp-1", ":hover");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("supports all valid selectors", async () => {
      const validSelectors = [
        ":hover", ":active", ":focus", ":focus-visible",
        ":focus-within", ":focus-visible-within",
        ":disabled", ":visited", ":link", "::placeholder",
      ];

      for (const selector of validSelectors) {
        vi.clearAllMocks();
        mockFastBundle.mockReturnValue({ map: {}, root: "0" });
        mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
        mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });

        const root = mkTag({ uuid: "root-1" });
        const comp = mkComponent({ uuid: "comp-1", tplTree: root });
        (comp as any).variants = [];
        const session = makeSession({ site: { components: [comp] } });
        setSession(session);
        initChangeTracker(session.site);

        const mockVariant = { uuid: `${selector}-uuid`, selectors: [selector], forTpl: null };
        mockCreateStyleVariant.mockReturnValue(mockVariant);

        const result = await createStyleVariant(api, "comp-1", selector);
        expect(result.selector).toBe(selector);

        disposeChangeTracker();
        clearSession();
      }
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createStyleVariant(api, "nonexistent", ":hover")
      ).rejects.toThrow("not found");
    });
  });

  // --- createVariantGroup ---

  describe("createVariantGroup", () => {
    it("creates a single-choice variant group with no initial variants", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", name: "Card", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Size");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "Size",
        optionsType: "singleChoice",
      });
      expect(result.groupUuid).toBe("group-uuid");
      expect(result.groupName).toBe("Size");
      expect(result.type).toBe("single");
      expect(result.variants).toEqual([]);
    });

    it("creates a multi-choice variant group", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Features" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Features", "multi");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "Features",
        optionsType: "multiChoice",
      });
      expect(result.type).toBe("multi");
    });

    it("creates a toggle (standalone) variant group with auto-created variant", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      // Standalone auto-creates one variant named after the group
      const autoVariant = { uuid: "auto-var-uuid", name: "isActive" };
      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "isActive" } },
        variants: [autoVariant],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "isActive", "toggle");

      expect(mockCreateVariantGroup).toHaveBeenCalledWith({
        component: comp,
        name: "isActive",
        optionsType: "standalone",
      });
      expect(result.type).toBe("toggle");
      expect(result.variants).toEqual([{ uuid: "auto-var-uuid", name: "isActive" }]);
    });

    it("creates initial variants when provided", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      // Mock createVariant to return proper objects
      let callCount = 0;
      mockCreateVariant.mockImplementation((_comp: any, _group: any, name: string) => {
        callCount++;
        return { uuid: `var-${callCount}`, name };
      });

      const result = await createVariantGroup(
        api, "comp-1", "Size", "single", ["Small", "Medium", "Large"]
      );

      expect(mockCreateVariant).toHaveBeenCalledTimes(3);
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Small");
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Medium");
      expect(mockCreateVariant).toHaveBeenCalledWith(comp, mockGroup, "Large");
      expect(result.variants).toEqual([
        { uuid: "var-1", name: "Small" },
        { uuid: "var-2", name: "Medium" },
        { uuid: "var-3", name: "Large" },
      ]);
    });

    it("saves changes to the server", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "Size" } },
        variants: [],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);

      const result = await createVariantGroup(api, "comp-1", "Size");

      expect(api.saveRevision).toHaveBeenCalledTimes(1);
      expect(result.save.revisionNum).toBe(11);
    });

    it("throws for unknown component UUID", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      await expect(
        createVariantGroup(api, "nonexistent", "Size")
      ).rejects.toThrow("not found");
    });

    it("includes both toggle auto-variant and initial variants", async () => {
      const root = mkTag({ uuid: "root-1" });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });
      setupSession(comp);

      const autoVariant = { uuid: "auto-uuid", name: "isExpanded" };
      const mockGroup = {
        uuid: "group-uuid",
        param: { variable: { name: "isExpanded" } },
        variants: [autoVariant],
      };
      mockCreateVariantGroup.mockReturnValue(mockGroup);
      mockCreateVariant.mockReturnValue({ uuid: "extra-uuid", name: "Extra" });

      const result = await createVariantGroup(
        api, "comp-1", "isExpanded", "toggle", ["Extra"]
      );

      // Should have the auto-created variant plus the explicitly created one
      expect(result.variants).toEqual([
        { uuid: "auto-uuid", name: "isExpanded" },
        { uuid: "extra-uuid", name: "Extra" },
      ]);
    });
  });

  // ==========================================================================
  // Error recovery: auto-rollback on save failure
  //
  // When saveManager.saveChanges() fails (network error, 412 conflict, site
  // invariant violation), the in-memory model must be automatically reverted
  // so the next mutation can succeed without calling refresh-project.
  // ==========================================================================

  describe("error recovery: auto-rollback on save failure", () => {
    it("rolls back model changes when updateStyles save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      // Return non-empty changes so rollback has something to undo
      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      // Make save fail
      api.saveRevision.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Network error");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("rolls back model changes when updateText save fails", async () => {
      const textNode = mkTag({
        uuid: "text-1",
        name: "Title",
        text: "Original",
      });
      const root = mkTag({ uuid: "root-1", children: [textNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      const fakeChanges = {
        changes: [{ changeNode: { inst: {}, field: "text" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      };
      mockWithRecording.mockReturnValue(fakeChanges);

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));

      await expect(
        updateText(api, "comp-1", "Title", "New text")
      ).rejects.toThrow("Save failed");

      // undoChanges should have been called to rollback
      expect(mockUndoChanges).toHaveBeenCalledWith(fakeChanges.changes);
    });

    it("does not push to undo stack when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // Clear undo stack before test to isolate from other tests
      const { getUndoDepth, clearUndoStack } = await import("../undo-manager");
      clearUndoStack();

      api.saveRevision.mockRejectedValueOnce(new Error("Server down"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(getUndoDepth()).toBe(0);
    });

    it("does not increment revision when save fails", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      const session = setupSession(comp);
      const originalRevision = session.revisionNum;
      api.saveRevision.mockRejectedValueOnce(new Error("Conflict"));

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow();

      expect(session.revisionNum).toBe(originalRevision);
    });

    it("subsequent mutation succeeds after failed save (no refresh needed)", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      // First call fails
      api.saveRevision.mockRejectedValueOnce(new Error("Temporary error"));
      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("Temporary error");

      // Second call succeeds (no refresh-project needed)
      api.saveRevision.mockResolvedValueOnce({});
      const result = await updateStyles(api, "comp-1", "Box", { color: "blue" });
      expect(result.save.revisionNum).toBe(11);
    });

    it("validation errors do not accumulate in change tracker", async () => {
      const containerNode = mkTag({
        uuid: "container-1",
        name: "Container",
        children: [mkTag({ uuid: "child-1" })],
      });
      const root = mkTag({ uuid: "root-1", children: [containerNode] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);

      setupSession(comp);

      // updateText on a container should fail before any recording
      await expect(
        updateText(api, "comp-1", "Container", "text")
      ).rejects.toThrow("container");

      // No save should have been attempted
      expect(api.saveRevision).not.toHaveBeenCalled();
      // No undo should have been called (no changes to undo)
      expect(mockUndoChanges).not.toHaveBeenCalled();
    });

    it("reports rollback failure with refresh-project guidance", async () => {
      const node = mkTag({ uuid: "node-1", name: "Box" });
      const root = mkTag({ uuid: "root-1", children: [node] });
      const comp = mkComponent({ uuid: "comp-1", tplTree: root });

      mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
      mockWithRecording.mockReturnValue({
        changes: [{ changeNode: { inst: {}, field: "x" }, type: "update" }],
        newInsts: [],
        removedInsts: [],
      });

      setupSession(comp);

      api.saveRevision.mockRejectedValueOnce(new Error("Save failed"));
      // Make undoChanges throw to simulate rollback failure
      mockUndoChanges.mockImplementationOnce(() => {
        throw new Error("Rollback crashed");
      });

      await expect(
        updateStyles(api, "comp-1", "Box", { color: "red" })
      ).rejects.toThrow("refresh-project");
    });
  });
});
