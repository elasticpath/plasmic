/**
 * Unit tests for the component domain.
 *
 * Covers: renameComponent, updatePageMeta, deleteComponent,
 * listProps, addProp, removeProp, updateProp,
 * listStates, addState, removeState, updateState,
 * convertToPage, convertToComponent.
 *
 * Extracted from edit-tools.test.ts.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  renameComponent,
  updatePageMeta,
  deleteComponent,
  listProps,
  addProp,
  removeProp,
  updateProp,
  listStates,
  addState,
  removeState,
  updateState,
  convertToPage,
  convertToComponent,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockRenameComponent,
  mockRemoveComponent,
  mockGetUniqueParamName,
  mockRenameParam,
  mockConvertComponentToPage,
  mockConvertPageToComponent,
  mockChangePagePath,
} from "../__mocks__/wab-tpl-mgr";
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

// =============================================================================
// Component lifecycle — rename, updatePageMeta, delete
// =============================================================================

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
});

// =============================================================================
// Component Props CRUD
// =============================================================================

describe("listProps", () => {
  it("returns empty array for component with no params", () => {
    const comp = { params: [] };
    const result = listProps(comp);
    expect(result).toEqual([]);
  });

  it("lists PropParam with correct fields", () => {
    const comp = {
      params: [
        {
          _type: "PropParam",
          uuid: "p1",
          variable: { name: "title" },
          type: { name: "text" },
          exportType: "External",
          required: false,
          description: "Page title",
          displayName: "Title",
          defaultExpr: null,
        },
      ],
    };
    const result = listProps(comp);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      uuid: "p1",
      name: "title",
      type: "text",
      paramKind: "prop",
      exportType: "External",
      required: false,
      isSlot: false,
      isState: false,
      description: "Page title",
      displayName: "Title",
    });
  });

  it("maps WAB type names to user-facing types", () => {
    const comp = {
      params: [
        { _type: "PropParam", uuid: "p1", variable: { name: "a" }, type: { name: "bool" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p2", variable: { name: "b" }, type: { name: "num" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p3", variable: { name: "c" }, type: { name: "any" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p4", variable: { name: "d" }, type: { name: "img" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p5", variable: { name: "e" }, type: { name: "href" }, exportType: "External", required: false },
        { _type: "PropParam", uuid: "p6", variable: { name: "f" }, type: { name: "func" }, exportType: "External", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result.map((p: any) => p.type)).toEqual([
      "boolean", "number", "object", "image", "href", "eventHandler",
    ]);
  });

  it("identifies slot params", () => {
    const comp = {
      params: [
        { _type: "SlotParam", uuid: "s1", variable: { name: "children" }, type: { name: "renderable" }, exportType: "External", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result[0].isSlot).toBe(true);
    expect(result[0].paramKind).toBe("slot");
  });

  it("identifies state params", () => {
    const comp = {
      params: [
        { _type: "StateParam", uuid: "st1", variable: { name: "count" }, type: { name: "num" }, exportType: "Internal", required: false },
        { _type: "StateChangeHandlerParam", uuid: "sch1", variable: { name: "onChange" }, type: { name: "func" }, exportType: "Internal", required: false },
      ],
    };
    const result = listProps(comp);
    expect(result[0].isState).toBe(true);
    expect(result[0].paramKind).toBe("state");
    expect(result[1].isState).toBe(true);
    expect(result[1].paramKind).toBe("stateChangeHandler");
  });

  it("extracts CustomCode default expression", () => {
    const comp = {
      params: [
        {
          _type: "PropParam",
          uuid: "p1",
          variable: { name: "title" },
          type: { name: "text" },
          exportType: "External",
          required: false,
          defaultExpr: { _type: "CustomCode", code: '"Hello"', fallback: null },
        },
      ],
    };
    const result = listProps(comp);
    expect(result[0].defaultExpr).toBe('"Hello"');
  });

  it("handles component with undefined params", () => {
    const comp = {};
    const result = listProps(comp);
    expect(result).toEqual([]);
  });
});

describe("addProp", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("creates a text prop with default value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "title", "text", "Untitled");

    expect(result.name).toBe("title");
    expect(result.type).toBe("text");
    expect(result.paramUuid).toBeDefined();
    expect(comp.params).toHaveLength(1);
    expect(comp.params[0]._type).toBe("PropParam");
    expect(comp.params[0].variable.name).toBe("title");
    expect(comp.params[0].type._type).toBe("Text");
    expect(comp.params[0].defaultExpr._type).toBe("CustomCode");
    expect(comp.params[0].defaultExpr.code).toBe('"Untitled"');
    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "title");
  });

  it("creates a boolean prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "showIcon", "boolean", "true");

    expect(result.type).toBe("boolean");
    expect(comp.params[0].type._type).toBe("BoolType");
    expect(comp.params[0].defaultExpr.code).toBe("true");
  });

  it("creates a number prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addProp(api, "comp-1", "count", "number", "42");

    expect(result.type).toBe("number");
    expect(comp.params[0].type._type).toBe("Num");
    expect(comp.params[0].defaultExpr.code).toBe("42");
  });

  it("creates a prop without default value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "data", "object");

    expect(comp.params[0].type._type).toBe("AnyType");
    expect(comp.params[0].defaultExpr).toBeNull();
  });

  it("creates an href prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "link", "href");

    expect(comp.params[0].type._type).toBe("HrefType");
  });

  it("creates an eventHandler prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "onClick", "eventHandler");

    expect(comp.params[0].type._type).toBe("FunctionType");
  });

  it("rejects reserved prop names", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(addProp(api, "comp-1", "children", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "key", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "ref", "text")).rejects.toThrow(
      /reserved/
    );
    await expect(addProp(api, "comp-1", "className", "text")).rejects.toThrow(
      /reserved/
    );
  });

  it("rejects invalid prop type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(addProp(api, "comp-1", "x", "slot")).rejects.toThrow(
      /Invalid prop type/
    );
  });

  it("rejects invalid boolean default", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addProp(api, "comp-1", "flag", "boolean", "yes")
    ).rejects.toThrow(/Must be "true" or "false"/);
  });

  it("rejects invalid number default", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addProp(api, "comp-1", "count", "number", "abc")
    ).rejects.toThrow(/Must be a valid number/);
  });

  it("sets description when provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addProp(api, "comp-1", "title", "text", undefined, "The page title");

    expect(comp.params[0].description).toBe("The page title");
  });
});

describe("removeProp", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("removes a prop by name", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "title");

    expect(result.removedName).toBe("title");
    expect(result.removedUuid).toBe("p1");
    expect(comp.params).toHaveLength(0);
  });

  it("removes a prop by UUID", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "p1");

    expect(result.removedName).toBe("title");
    expect(comp.params).toHaveLength(0);
  });

  it("cleans up Args on component instances", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];

    // Another component has a TplComponent instance referencing comp
    const instanceNode = {
      _type: "TplComponent",
      uuid: "inst-1",
      component: comp,
      vsettings: [
        {
          args: [
            { param, expr: { _type: "CustomCode", code: '"Hello"' } },
          ],
        },
      ],
      children: [],
    };
    const otherRoot = mkTag({ uuid: "other-root", children: [instanceNode] });
    const otherComp = mkComponent({ uuid: "other-comp", tplTree: otherRoot });

    const site = { components: [comp, otherComp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeProp(api, "comp-1", "title");

    expect(result.cleanedArgCount).toBe(1);
    expect(instanceNode.vsettings[0].args).toHaveLength(0);
  });

  it("throws for non-existent prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeProp(api, "comp-1", "nonExistent")).rejects.toThrow(
      /not found/
    );
  });

  it("rejects removal of state params", async () => {
    const param = {
      _type: "StateParam",
      uuid: "st1",
      variable: { name: "count" },
      type: { name: "num" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeProp(api, "comp-1", "count")).rejects.toThrow(
      /state param/i
    );
  });
});

describe("updateProp", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("renames a prop via TplMgr.renameParam", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(api, "comp-1", "title", "heading");

    expect(mockRenameParam).toHaveBeenCalledWith(comp, param, "heading");
    expect(result.previousName).toBe("title");
    expect(result.updatedFields).toContain("name");
  });

  it("updates default value", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      defaultExpr: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(api, "comp-1", "title", undefined, "New Default");

    expect(result.updatedFields).toContain("defaultValue");
    expect(param.defaultExpr._type).toBe("CustomCode");
    expect(param.defaultExpr.code).toBe('"New Default"');
  });

  it("updates description", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      description: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateProp(
      api, "comp-1", "title", undefined, undefined, "Page heading"
    );

    expect(result.updatedFields).toContain("description");
    expect(param.description).toBe("Page heading");
  });

  it("clears description with empty string", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
      description: "Old desc",
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateProp(api, "comp-1", "title", undefined, undefined, "");

    expect(param.description).toBeNull();
  });

  it("throws for non-existent prop", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateProp(api, "comp-1", "nonExistent", "newName")
    ).rejects.toThrow(/not found/);
  });

  it("rejects reserved name for rename", async () => {
    const param = {
      _type: "PropParam",
      uuid: "p1",
      variable: { name: "title" },
      type: { name: "text" },
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [param];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateProp(api, "comp-1", "title", "children")
    ).rejects.toThrow(/reserved/);
  });
});

// =============================================================================
// State Management — CRUD operations for component state variables
// =============================================================================

describe("listStates", () => {
  it("returns empty array for component with no states", () => {
    const comp = { states: [], params: [] };
    const result = listStates(comp);
    expect(result).toEqual([]);
  });

  it("returns named states with info", () => {
    const param = {
      _type: "StateParam",
      uuid: "state-param-1",
      variable: { name: "isOpen" },
      defaultExpr: { _type: "CustomCode", code: "false" },
    };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param,
    };
    const comp = { states: [state], params: [param] };
    const result = listStates(comp);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("isOpen");
    expect(result[0].variableType).toBe("boolean");
    expect(result[0].accessType).toBe("private");
    expect(result[0].initialValue).toBe("false");
  });

  it("filters out non-NamedState entries", () => {
    const state1 = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      accessType: "private",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "count" } },
    };
    const variantGroupState = {
      _type: "VariantGroupState",
      variableType: "variant",
      param: { _type: "StateParam", uuid: "sp2", variable: { name: "color" } },
    };
    const comp = { states: [state1, variantGroupState], params: [] };
    const result = listStates(comp);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("count");
  });
});

describe("addState", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("creates a boolean state with initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "isOpen", "boolean", "private", "false");

    expect(result.name).toBe("isOpen");
    expect(result.variableType).toBe("boolean");
    expect(result.accessType).toBe("private");
    expect(result.stateUuid).toBeDefined();
    expect(comp.states).toHaveLength(1);
    expect(comp.states[0]._type).toBe("NamedState");
    expect(comp.states[0].name).toBe("isOpen");
    expect(comp.states[0].variableType).toBe("boolean");
    expect(comp.states[0].accessType).toBe("private");
    // Value param
    expect(comp.states[0].param._type).toBe("StateParam");
    expect(comp.states[0].param.type._type).toBe("BoolType");
    expect(comp.states[0].param.defaultExpr._type).toBe("CustomCode");
    expect(comp.states[0].param.defaultExpr.code).toBe("false");
    expect(comp.states[0].param.exportType).toBe("ToolsOnly");
    // onChange param
    expect(comp.states[0].onChangeParam._type).toBe("StateChangeHandlerParam");
    expect(comp.states[0].onChangeParam.type._type).toBe("FunctionType");
    // Both params pushed to component.params
    expect(comp.params).toHaveLength(2);
    expect(comp.params[0]._type).toBe("StateParam");
    expect(comp.params[1]._type).toBe("StateChangeHandlerParam");
  });

  it("creates a text state without initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "searchQuery", "text");

    expect(result.variableType).toBe("text");
    expect(comp.states[0].param.type._type).toBe("Text");
    expect(comp.states[0].param.defaultExpr).toBeNull();
  });

  it("creates a number state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "count", "number", "private", "0");

    expect(result.variableType).toBe("number");
    expect(comp.states[0].param.type._type).toBe("Num");
    expect(comp.states[0].param.defaultExpr.code).toBe("0");
  });

  it("creates a writable state with External export", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addState(api, "comp-1", "value", "text", "writable");

    expect(result.accessType).toBe("writable");
    expect(comp.states[0].param.exportType).toBe("External");
    expect(comp.states[0].onChangeParam.exportType).toBe("External");
  });

  it("creates a readonly state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "value", "text", "readonly");

    expect(comp.states[0].param.exportType).toBe("ToolsOnly");
    expect(comp.states[0].onChangeParam.exportType).toBe("External");
  });

  it("sets back-references: param.state and onChangeParam.state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "isOpen", "boolean");

    const state = comp.states[0];
    expect(state.param.state).toBe(state);
    expect(state.onChangeParam.state).toBe(state);
  });

  it("rejects duplicate state name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [
      { _type: "NamedState", name: "isOpen", variableType: "boolean", param: { uuid: "p1" } },
    ];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "isOpen", "boolean")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects invalid variable type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "x", "variant")
    ).rejects.toThrow(/Invalid variable type/);
  });

  it("rejects invalid access type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "x", "text", "public" as any)
    ).rejects.toThrow(/Invalid access type/);
  });

  it("rejects invalid boolean initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "flag", "boolean", "private", "yes")
    ).rejects.toThrow(/Must be "true" or "false"/);
  });

  it("rejects invalid number initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addState(api, "comp-1", "count", "number", "private", "abc")
    ).rejects.toThrow(/Must be a valid number/);
  });

  it("creates array and object state types", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "items", "array", "private", "[]");
    expect(comp.states[0].param.type._type).toBe("AnyType");
    expect(comp.states[0].param.defaultExpr.code).toBe("[]");

    // Reset for next
    comp.params = [];
    comp.states = [];
    await addState(api, "comp-1", "config", "object", "private", "{}");
    expect(comp.states[0].param.type._type).toBe("AnyType");
    expect(comp.states[0].param.defaultExpr.code).toBe("{}");
  });

  it("calls getUniqueParamName for deduplication", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addState(api, "comp-1", "count", "number");

    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "count");
    // Also for the onChange param name
    expect(mockGetUniqueParamName).toHaveBeenCalledWith(comp, "On count change");
  });
});

describe("removeState", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("removes a state by name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "isOpen");

    expect(result.removedName).toBe("isOpen");
    expect(comp.states).toHaveLength(0);
    expect(comp.params).toHaveLength(0);
  });

  it("removes a state by param UUID", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "count" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On count change" } };
    const state = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "sp1");

    expect(result.removedName).toBe("count");
    expect(result.removedUuid).toBe("sp1");
    expect(comp.states).toHaveLength(0);
    expect(comp.params).toHaveLength(0);
  });

  it("cleans up Args on TplComponent instances", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];

    // Another component that has a TplComponent instance referencing comp
    const tplCompInstance = {
      _type: "TplComponent",
      component: comp,
      vsettings: [
        {
          args: [
            { param: valueParam, expr: { _type: "CustomCode", code: "true" } },
            { param: onChangeParam, expr: { _type: "CustomCode", code: "() => {}" } },
            { param: { uuid: "other-param" }, expr: { _type: "CustomCode", code: "42" } },
          ],
        },
      ],
      children: [],
    };
    const otherRoot = mkTag({ uuid: "other-root", children: [tplCompInstance] });
    const otherComp = mkComponent({ uuid: "comp-2", tplTree: otherRoot });

    const site = { components: [comp, otherComp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeState(api, "comp-1", "isOpen");

    expect(result.cleanedArgCount).toBe(2);
    // Only the "other-param" arg remains
    expect(tplCompInstance.vsettings[0].args).toHaveLength(1);
    expect(tplCompInstance.vsettings[0].args[0].param.uuid).toBe("other-param");
  });

  it("throws when state not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeState(api, "comp-1", "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

describe("updateState", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearNodeCache();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });

  afterEach(() => {
    disposeChangeTracker();
    clearSession();
    vi.restoreAllMocks();
  });

  it("renames a state", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } };
    const state = {
      _type: "NamedState",
      name: "isOpen",
      variableType: "boolean",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "isOpen", "isVisible");

    expect(result.name).toBe("isVisible");
    expect(result.previousName).toBe("isOpen");
    expect(result.updatedFields).toContain("name");
    expect(state.name).toBe("isVisible");
    expect(mockRenameParam).toHaveBeenCalledWith(comp, valueParam, "isVisible");
    expect(mockRenameParam).toHaveBeenCalledWith(comp, onChangeParam, "On isVisible change");
  });

  it("updates access type from private to writable", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = { _type: "StateParam", uuid: "sp1", variable: { name: "value" }, exportType: "ToolsOnly" };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On value change" }, exportType: "ToolsOnly" };
    const state = {
      _type: "NamedState",
      name: "value",
      variableType: "text",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "value", undefined, "writable");

    expect(result.updatedFields).toContain("accessType");
    expect(state.accessType).toBe("writable");
    expect(valueParam.exportType).toBe("External");
    expect(onChangeParam.exportType).toBe("External");
  });

  it("updates initial value", async () => {
    const root = mkTag({ uuid: "root-1" });
    const valueParam = {
      _type: "StateParam", uuid: "sp1", variable: { name: "count" },
      defaultExpr: { _type: "CustomCode", code: "0" },
    };
    const onChangeParam = { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On count change" } };
    const state = {
      _type: "NamedState",
      name: "count",
      variableType: "number",
      accessType: "private",
      param: valueParam,
      onChangeParam,
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [valueParam, onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateState(api, "comp-1", "count", undefined, undefined, "10");

    expect(result.updatedFields).toContain("initialValue");
    expect(valueParam.defaultExpr._type).toBe("CustomCode");
    expect(valueParam.defaultExpr.code).toBe("10");
  });

  it("rejects duplicate name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const state1 = {
      _type: "NamedState", name: "isOpen", variableType: "boolean",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } },
    };
    const state2 = {
      _type: "NamedState", name: "count", variableType: "number",
      param: { _type: "StateParam", uuid: "sp2", variable: { name: "count" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp2", variable: { name: "On count change" } },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [state1.param, state1.onChangeParam, state2.param, state2.onChangeParam];
    (comp as any).states = [state1, state2];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "count", "isOpen")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects invalid access type", async () => {
    const root = mkTag({ uuid: "root-1" });
    const state = {
      _type: "NamedState", name: "isOpen", variableType: "boolean",
      param: { _type: "StateParam", uuid: "sp1", variable: { name: "isOpen" } },
      onChangeParam: { _type: "StateChangeHandlerParam", uuid: "ocp1", variable: { name: "On isOpen change" } },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [state.param, state.onChangeParam];
    (comp as any).states = [state];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "isOpen", undefined, "public" as any)
    ).rejects.toThrow(/Invalid access type/);
  });

  it("throws when state not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).params = [];
    (comp as any).states = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateState(api, "comp-1", "nonexistent", "newName")
    ).rejects.toThrow(/not found/);
  });
});

// ==========================================================================
// convertToPage / convertToComponent
// ==========================================================================

describe("convertToPage", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("converts a component to a page", async () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: root });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await convertToPage(api, "comp1", "/my-page");
    expect(result.componentName).toBe("MyComp");
    expect(mockConvertComponentToPage).toHaveBeenCalled();
    expect(mockChangePagePath).toHaveBeenCalled();
  });

  it("throws if already a page", async () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "MyPage", tplTree: root });
    comp.pageMeta = { path: "/existing" };
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(convertToPage(api, "comp1")).rejects.toThrow(/already a page/);
  });
});

describe("convertToComponent", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("converts a page to a component", async () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "MyPage", tplTree: root });
    comp.pageMeta = { path: "/my-page" };
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await convertToComponent(api, "comp1");
    expect(result.componentName).toBe("MyPage");
    expect(mockConvertPageToComponent).toHaveBeenCalled();
  });

  it("throws if already a component", async () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: root });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(convertToComponent(api, "comp1")).rejects.toThrow(/already a component/);
  });
});
