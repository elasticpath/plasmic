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

import {
  updateText,
  updateStyles,
  addChild,
  removeChild,
  moveChild,
  resolveVariant,
  listVariants,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
} from "../__mocks__/wab-tpl-mgr";
import { mockMkTplTagX, mockMkTplInlinedText, mockMkTplComponentX } from "../__mocks__/wab-tpls";
import { mockEnsureVariantSetting } from "../__mocks__/wab-variants";
import type { PlasmicApiClient } from "../api-client";
import type { Session } from "../session";

// --- Test helpers ---

function mockApiClient() {
  return {
    saveRevision: jest.fn().mockResolvedValue({}),
    listProjects: jest.fn(),
    getProjectBundle: jest.fn(),
    updateProject: jest.fn(),
  } as unknown as PlasmicApiClient & { saveRevision: jest.Mock };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test",
    site: { components: [] },
    bundler: {
      fastBundle: mockFastBundle,
      addrOf: mockAddrOf,
      bundle: jest.fn().mockReturnValue({ map: {}, root: "0" }),
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

describe("edit-tools", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
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
    jest.restoreAllMocks();
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
});
