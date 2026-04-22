/**
 * Unit tests for the data domain of edit-tools.ts
 *
 * Covers: setDataCond, setDataRep, listQueries, addQuery, removeQuery,
 * updateQuery, listDataTokens, createDataToken, updateDataToken,
 * removeDataToken, getCodeComponentMeta, listCustomFunctions, listSplits,
 * createSplit, updateSplit, removeSplit.
 *
 * Extracted from edit-tools.test.ts. All test assertions are preserved exactly.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  setDataCond,
  setDataRep,
  listQueries,
  addQuery,
  removeQuery,
  updateQuery,
  listDataTokens,
  createDataToken,
  updateDataToken,
  removeDataToken,
  getCodeComponentMeta,
  listCustomFunctions,
  listSplits,
  createSplit,
  updateSplit,
  removeSplit,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockEnsureBaseVariantSetting,
  mockRemoveComponentQuery,
  mockRemoveComponentServerQuery,
  mockAddDataToken,
  mockRenameDataToken,
  mockRemoveSplit,
} from "../__mocks__/wab-tpl-mgr";
import { mockEnsureVariantSetting } from "../__mocks__/wab-variants";
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

// =============================================================================
// setDataCond
// =============================================================================

describe("setDataCond", () => {
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

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  it("sets condition expression", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", "$ctx.showBanner");

    expect(result.newCondition).toBe("$ctx.showBanner");
    expect(result.previousCondition).toBeNull();
    expect(result.nodeName).toBe("Banner");
    expect(result.nodeUuid).toBe("node-1");
    expect(node.vsettings[0].dataCond._type).toBe("CustomCode");
    expect(node.vsettings[0].dataCond.code).toBe("$ctx.showBanner");
    expect(result.save.revisionNum).toBe(11);
  });

  it("removes condition with null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "$ctx.showBanner", fallback: null };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", null);

    expect(result.newCondition).toBeNull();
    expect(result.previousCondition).toBe("$ctx.showBanner");
    expect(node.vsettings[0].dataCond).toBeNull();
  });

  it("captures ObjectPath as previous condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = {
      _type: "ObjectPath",
      path: ["$ctx", "user", "isLoggedIn"],
      fallback: null,
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Banner", "$ctx.isActive");

    expect(result.previousCondition).toBe("$ctx.user.isLoggedIn");
  });

  it("clears display-none marker when setting condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    await setDataCond(api, "comp-1", "Banner", "$ctx.showBanner");

    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
    expect(node.vsettings[0].dataCond.code).toBe("$ctx.showBanner");
  });

  it("clears display-none marker when removing condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    node.vsettings[0].dataCond = { _type: "CustomCode", code: "true", fallback: null };
    node.vsettings[0].rs.values["plasmic-display-none"] = "true";
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    await setDataCond(api, "comp-1", "Banner", null);

    expect(node.vsettings[0].rs.values["plasmic-display-none"]).toBeUndefined();
    expect(node.vsettings[0].dataCond).toBeNull();
  });

  it("works on TplComponent nodes", async () => {
    const compNode: any = {
      _type: "TplComponent",
      uuid: "comp-node-1",
      name: "Widget",
      component: { name: "Widget", uuid: "widget-def" },
      vsettings: [{ rs: { values: {} }, args: [] }],
    };
    const root = mkTag({ uuid: "root-1", children: [compNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Widget", "$ctx.showWidget");

    expect(result.newCondition).toBe("$ctx.showWidget");
    expect(compNode.vsettings[0].dataCond.code).toBe("$ctx.showWidget");
  });

  it("rejects TplSlot nodes", async () => {
    const slotNode: any = {
      _type: "TplSlot",
      uuid: "slot-1",
      name: "content",
      param: { variable: { name: "children" } },
      defaultContents: [],
    };
    const root = mkTag({ uuid: "root-1", children: [slotNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    setupSession(comp);

    await expect(
      setDataCond(api, "comp-1", "content", "$ctx.show")
    ).rejects.toThrow(/not a TplTag or TplComponent/);
  });

  it("supports variant-aware data condition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Banner" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const mobileVariant = {
      uuid: "mobile-v",
      name: "Mobile",
      selectors: [],
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).variantGroups = [{ variants: [mobileVariant] }];
    (comp as any).variants = [];

    const mobileVs = { rs: { values: {} }, variants: [mobileVariant] };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);
    const session = makeSession({
      site: {
        components: [comp],
        globalVariantGroups: [],
      } as any,
    });
    setSession(session);
    initChangeTracker(session.site);

    const result = await setDataCond(
      api, "comp-1", "Banner", "$ctx.isMobileUser", "Mobile"
    );

    expect(result.newCondition).toBe("$ctx.isMobileUser");
    expect((mobileVs as any).dataCond?.code).toBe("$ctx.isMobileUser");
  });

  it("save is called and revision returned", async () => {
    const node = mkTag({ uuid: "node-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataCond(api, "comp-1", "Item", "$ctx.show");

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11);
  });
});

// =============================================================================
// setDataRep
// =============================================================================

describe("setDataRep", () => {
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

  function setupSession(component: any) {
    const session = makeSession({ site: { components: [component] } });
    setSession(session);
    initChangeTracker(session.site);
    return session;
  }

  it("sets data repetition with default variables", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", "$queries.products.data");

    expect(result.newDataRep).toEqual({
      collection: "$queries.products.data",
      elementVariable: "currentItem",
      indexVariable: "currentIndex",
    });
    expect(result.previousDataRep).toBeNull();
    expect(result.nodeName).toBe("Card");
    expect(result.nodeUuid).toBe("node-1");
    // Verify the Rep was set on the variant setting
    const vs = node.vsettings[0];
    expect(vs.dataRep).toBeTruthy();
    expect(vs.dataRep._type).toBe("Rep");
    expect(vs.dataRep.element._type).toBe("Var");
    expect(vs.dataRep.element.name).toBe("currentItem");
    expect(vs.dataRep.index._type).toBe("Var");
    expect(vs.dataRep.index.name).toBe("currentIndex");
    expect(vs.dataRep.collection._type).toBe("CustomCode");
    expect(vs.dataRep.collection.code).toBe("$queries.products.data");
  });

  it("sets data repetition with custom variable names", async () => {
    const node = mkTag({ uuid: "node-1", name: "ProductRow" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "ProductRow",
      "$ctx.products",
      "product",
      "idx"
    );

    expect(result.newDataRep).toEqual({
      collection: "$ctx.products",
      elementVariable: "product",
      indexVariable: "idx",
    });
    const vs = node.vsettings[0];
    expect(vs.dataRep.element.name).toBe("product");
    expect(vs.dataRep.index.name).toBe("idx");
  });

  it("sets data repetition without index variable when null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Item" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "Item",
      "[1,2,3]",
      "num",
      null
    );

    expect(result.newDataRep).toEqual({
      collection: "[1,2,3]",
      elementVariable: "num",
    });
    const vs = node.vsettings[0];
    expect(vs.dataRep.index).toBeNull();
  });

  it("removes data repetition when collection is null", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    // Set up existing dataRep
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "item", uuid: "var-1" },
      index: { _type: "Var", name: "idx", uuid: "var-2" },
      collection: { _type: "CustomCode", code: "$ctx.items", fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", null);

    expect(result.newDataRep).toBeNull();
    expect(result.previousDataRep).toEqual({
      collection: "$ctx.items",
      elementVariable: "item",
      indexVariable: "idx",
    });
    expect(node.vsettings[0].dataRep).toBeNull();
  });

  it("reports previous ObjectPath collection", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "product", uuid: "var-1" },
      index: null,
      collection: { _type: "ObjectPath", path: ["$queries", "products", "data"], fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", null);

    expect(result.previousDataRep).toEqual({
      collection: "$queries.products.data",
      elementVariable: "product",
    });
  });

  it("works on TplComponent nodes", async () => {
    const compNode: any = {
      _type: "TplComponent",
      uuid: "tplcomp-1",
      name: "ProductCard",
      component: { name: "Card", uuid: "card-comp-uuid" },
      vsettings: [{ rs: { values: {} }, args: [] }],
    };
    const root = mkTag({ uuid: "root-1", children: [compNode] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "ProductCard", "$ctx.items");

    expect(result.newDataRep!.collection).toBe("$ctx.items");
    expect(compNode.vsettings[0].dataRep._type).toBe("Rep");
  });

  it("rejects TplSlot nodes", async () => {
    const slot: any = {
      _type: "TplSlot",
      uuid: "slot-1",
      param: { variable: { name: "children" } },
      defaultContents: [],
    };
    const root = mkTag({ uuid: "root-1", children: [slot] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    setupSession(comp);

    await expect(
      setDataRep(api, "comp-1", "slot-1", "$ctx.items")
    ).rejects.toThrow(/not a TplTag or TplComponent/);
  });

  it("replaces existing dataRep with new one", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    node.vsettings[0].dataRep = {
      _type: "Rep",
      element: { _type: "Var", name: "oldItem", uuid: "var-1" },
      index: { _type: "Var", name: "oldIdx", uuid: "var-2" },
      collection: { _type: "CustomCode", code: "$ctx.oldItems", fallback: null },
    };
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(
      api,
      "comp-1",
      "Card",
      "$ctx.newItems",
      "newItem",
      "newIdx"
    );

    expect(result.previousDataRep).toEqual({
      collection: "$ctx.oldItems",
      elementVariable: "oldItem",
      indexVariable: "oldIdx",
    });
    expect(result.newDataRep).toEqual({
      collection: "$ctx.newItems",
      elementVariable: "newItem",
      indexVariable: "newIdx",
    });
    expect(node.vsettings[0].dataRep.element.name).toBe("newItem");
  });

  it("saves changes and returns revision", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    setupSession(comp);

    const result = await setDataRep(api, "comp-1", "Card", "$ctx.items");

    expect(api.saveRevision).toHaveBeenCalledTimes(1);
    expect(result.save.revisionNum).toBe(11);
  });

  it("supports variant-aware repetition", async () => {
    const node = mkTag({ uuid: "node-1", name: "Card" });
    const root = mkTag({ uuid: "root-1", children: [node] });
    const mobileVariant = { uuid: "var-mobile", name: "Mobile" };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).variants = [
      { uuid: "var-base", name: "base", selectors: null },
      mobileVariant,
    ];
    // Add variant to site globalVariantGroups for resolution
    const session = makeSession({
      site: {
        components: [comp],
        globalVariantGroups: [
          { variants: [mobileVariant], param: { variable: { name: "Screen" } } },
        ],
      } as any,
    });
    setSession(session);
    initChangeTracker(session.site);

    const mobileVs: any = { rs: { values: {} }, variants: [mobileVariant] };
    mockEnsureVariantSetting.mockReturnValue(mobileVs);

    const result = await setDataRep(
      api,
      "comp-1",
      "Card",
      "$ctx.mobileItems",
      undefined,
      undefined,
      "Mobile"
    );

    expect(result.newDataRep!.collection).toBe("$ctx.mobileItems");
    expect(mobileVs.dataRep._type).toBe("Rep");
  });
});

// =============================================================================
// listQueries
// =============================================================================

describe("listQueries", () => {
  beforeEach(() => {
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("returns empty array when no queries exist", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toEqual([]);
  });

  it("lists data queries", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
      { uuid: "q2", name: "categories", op: null },
    ];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ uuid: "q1", name: "products", queryType: "dataQuery" });
    expect(result[1]).toEqual({ uuid: "q2", name: "categories", queryType: "dataQuery" });
  });

  it("lists both data and server queries", () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
    ];
    (comp as any).serverQueries = [
      { uuid: "q2", name: "fetchUser", op: null },
    ];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listQueries(comp);
    expect(result).toHaveLength(2);
    expect(result[0].queryType).toBe("dataQuery");
    expect(result[1].queryType).toBe("serverQuery");
    expect(result[1].name).toBe("fetchUser");
  });
});

// =============================================================================
// addQuery — creating data queries on a component
// =============================================================================

describe("addQuery", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("adds a data query", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "products");
    expect(result.name).toBe("products");
    expect(result.queryType).toBe("dataQuery");
    expect(result.queryUuid).toBeTruthy();

    expect(comp.dataQueries).toHaveLength(1);
    expect(comp.dataQueries[0].name).toBe("products");
    expect(comp.dataQueries[0].uuid).toBe(result.queryUuid);
  });

  it("adds a server query", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "fetchUser", "serverQuery");
    expect(result.queryType).toBe("serverQuery");
    expect(comp.serverQueries).toHaveLength(1);
    expect(comp.serverQueries[0].name).toBe("fetchUser");
  });

  it("normalizes query name to valid identifier", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addQuery(api, "comp-1", "user-data");
    expect(result.name).toBe("userData");
  });

  it("rejects duplicate query name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [{ uuid: "q1", name: "products", op: null }];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addQuery(api, "comp-1", "products")
    ).rejects.toThrow(/already exists/);
  });

  it("rejects empty query name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addQuery(api, "comp-1", "")
    ).rejects.toThrow(/cannot be empty/);
  });
});

// =============================================================================
// removeQuery — removing data queries from a component
// =============================================================================

describe("removeQuery", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("removes a data query by name", async () => {
    const query = { _type: "ComponentDataQuery", uuid: "q1", name: "products", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [query];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeQuery(api, "comp-1", "products");
    expect(result.removedName).toBe("products");
    expect(result.removedUuid).toBe("q1");
    expect(result.queryType).toBe("dataQuery");
    expect(mockRemoveComponentQuery).toHaveBeenCalledWith(comp, query);
  });

  it("removes a server query by UUID", async () => {
    const query = { _type: "ComponentServerQuery", uuid: "sq1", name: "fetchUser", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [query];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeQuery(api, "comp-1", "sq1");
    expect(result.removedName).toBe("fetchUser");
    expect(result.queryType).toBe("serverQuery");
    expect(mockRemoveComponentServerQuery).toHaveBeenCalledWith(comp, query);
  });

  it("throws when query not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeQuery(api, "comp-1", "nonexistent")
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// updateQuery — renaming data queries
// =============================================================================

describe("updateQuery", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "100" });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("renames a data query", async () => {
    const query = { uuid: "q1", name: "products", op: null };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [query];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateQuery(api, "comp-1", "products", "items");
    expect(result.name).toBe("items");
    expect(query.name).toBe("items");
  });

  it("rejects duplicate name", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [
      { uuid: "q1", name: "products", op: null },
      { uuid: "q2", name: "categories", op: null },
    ];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "products", "categories")
    ).rejects.toThrow(/already exists/);
  });

  it("throws when no name or functionCall provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [{ uuid: "q1", name: "products", op: null }];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "products", undefined)
    ).rejects.toThrow(/at least one of.*name.*functionCall/i);
  });

  it("throws when query not found", async () => {
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [];
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "nonexistent", "newName")
    ).rejects.toThrow(/not found/);
  });

  // Gap #74 — functionCall param binds a server query to a registered
  // custom function. Tracer test: the happy path on a freshly-added server
  // query (op=null) should leave query.op as a CustomFunctionExpr whose
  // `func` points at the matching CustomFunction from site.customFunctions
  // and whose `args` carry one FunctionArg per provided arg name.
  it("gap #74 tracer: functionCall sets query.op to CustomFunctionExpr referencing the matching CustomFunction", async () => {
    // Mirror the Studio query-builder shape: a CustomFunction with one
    // `input` param of type ArgType.
    const inputParam: any = {
      _type: "ArgType",
      argName: "input",
      type: { _type: "AnyType" },
    };
    const { CustomFunction } = await import("../__mocks__/wab-classes");
    const getProductFn = new CustomFunction({
      namespace: "ep",
      importName: "getProduct",
      importPath: "@elasticpath/plasmic-ep-commerce-elastic-path/server",
      params: [inputParam],
      uid: 42,
    });

    const serverQuery: any = {
      _type: "ComponentServerQuery",
      uuid: "sq1",
      name: "product",
      op: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [serverQuery];
    const site = {
      components: [comp],
      styleTokens: [],
      customFunctions: [getProductFn],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateQuery(api, "comp-1", "product", undefined, {
      functionCall: {
        namespace: "ep",
        name: "getProduct",
        args: { input: "{id: $ctx.params.slug}" },
      },
    });

    expect(serverQuery.op).toBeTruthy();
    expect(serverQuery.op._type).toBe("CustomFunctionExpr");
    expect(serverQuery.op.func).toBe(getProductFn);
    expect(serverQuery.op.args).toHaveLength(1);
    expect(serverQuery.op.args[0]._type).toBe("FunctionArg");
    expect(serverQuery.op.args[0].argType).toBe(inputParam);
    // The user passed a JS expression, so the arg expr should be a
    // CustomCode carrying that code (same shape update-text produces for
    // dynamic text). `{{...}}` delimiters are stripped; `$foo` is unwrapped.
    expect(serverQuery.op.args[0].expr._type).toBe("CustomCode");
    // Stored wrapped in parens so `isRealCodeExpr` returns true — matches
    // Studio's `createExprForDataPickerValue` convention. See exprs.ts in
    // platform/wab. Without parens the op compiles to bare code and breaks
    // scope resolution for $q / $queries / $ctx references.
    expect(serverQuery.op.args[0].expr.code).toBe("({id: $ctx.params.slug})");
  });

  // Gap #74 error path — if the user supplies a functionCall pointing at a
  // function that isn't in site.customFunctions (typically because the dev
  // host never registered it, or project.sync-dev-host hasn't run since it
  // was added), surface a clear error that names the function and points
  // at the right recovery action. This prevents silent misconfiguration
  // where a server query gets bound to a phantom function reference.
  it("gap #74: throws with clear message when functionCall targets an unregistered function", async () => {
    const serverQuery: any = {
      _type: "ComponentServerQuery",
      uuid: "sq1",
      name: "product",
      op: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [serverQuery];
    const site = {
      components: [comp],
      styleTokens: [],
      customFunctions: [],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      updateQuery(api, "comp-1", "product", undefined, {
        functionCall: {
          namespace: "ep",
          name: "getProduct",
          args: { input: "{id: 'abc'}" },
        },
      })
    ).rejects.toThrow(/ep\.getProduct.*not found.*sync-dev-host/s);
    // Bundle must not be mutated when lookup fails.
    expect(serverQuery.op).toBeNull();
  });

  // Gap #74 composition — rename + bind in one call must mutate both fields
  // on the same query. This protects users from having to make two MCP
  // calls (rename, then bind) and avoids a partial-state window where a
  // query has a new name but its old op — or vice versa.
  it("gap #74: rename + functionCall in one call applies both atomically", async () => {
    const inputParam: any = {
      _type: "ArgType",
      argName: "input",
      type: { _type: "AnyType" },
    };
    const { CustomFunction } = await import("../__mocks__/wab-classes");
    const getProductFn = new CustomFunction({
      namespace: "ep",
      importName: "getProduct",
      importPath: "@elasticpath/plasmic-ep-commerce-elastic-path/server",
      params: [inputParam],
      uid: 99,
    });

    const serverQuery: any = {
      _type: "ComponentServerQuery",
      uuid: "sq1",
      name: "oldName",
      op: null,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [serverQuery];
    const site = {
      components: [comp],
      styleTokens: [],
      customFunctions: [getProductFn],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateQuery(api, "comp-1", "oldName", "product", {
      functionCall: {
        namespace: "ep",
        name: "getProduct",
        args: { input: "{id: $ctx.params.slug}" },
      },
    });

    expect(result.name).toBe("product");
    expect(serverQuery.name).toBe("product");
    expect(serverQuery.op?._type).toBe("CustomFunctionExpr");
    expect(serverQuery.op?.func).toBe(getProductFn);
  });

  // Gap #74 detach path — explicit functionCall: null clears an existing
  // op back to null, so the user can unbind a query without deleting and
  // re-adding it. Distinct from "functionCall field absent" (preserve).
  it("gap #74: functionCall: null clears the query op", async () => {
    const { CustomFunction, CustomFunctionExpr } = await import(
      "../__mocks__/wab-classes"
    );
    const existingFn = new CustomFunction({
      namespace: "ep",
      importName: "getProduct",
      importPath: "@elasticpath/plasmic-ep-commerce-elastic-path/server",
      params: [],
      uid: 7,
    });
    const existingOp = new CustomFunctionExpr({
      func: existingFn,
      args: [],
    });

    const serverQuery: any = {
      _type: "ComponentServerQuery",
      uuid: "sq1",
      name: "product",
      op: existingOp,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [serverQuery];
    const site = {
      components: [comp],
      styleTokens: [],
      customFunctions: [existingFn],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateQuery(api, "comp-1", "product", undefined, {
      functionCall: null,
    });

    expect(serverQuery.op).toBeNull();
    // Name preserved
    expect(serverQuery.name).toBe("product");
  });

  // Counter-case guard — NOT passing functionCall at all (only newName)
  // must leave an existing op untouched. Distinguishes "absent field"
  // from "explicit null".
  it("gap #74: rename alone preserves existing op", async () => {
    const { CustomFunction, CustomFunctionExpr } = await import(
      "../__mocks__/wab-classes"
    );
    const existingFn = new CustomFunction({
      namespace: "ep",
      importName: "getProduct",
      importPath: "@elasticpath/plasmic-ep-commerce-elastic-path/server",
      params: [],
      uid: 11,
    });
    const existingOp = new CustomFunctionExpr({
      func: existingFn,
      args: [],
    });
    const serverQuery: any = {
      _type: "ComponentServerQuery",
      uuid: "sq1",
      name: "oldName",
      op: existingOp,
    };
    const root = mkTag({ uuid: "root-1" });
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    (comp as any).dataQueries = [];
    (comp as any).serverQueries = [serverQuery];
    const site = {
      components: [comp],
      styleTokens: [],
      customFunctions: [existingFn],
      projectDependencies: [],
    };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await updateQuery(api, "comp-1", "oldName", "newName");

    expect(serverQuery.name).toBe("newName");
    // Op reference identity preserved — not replaced/cloned
    expect(serverQuery.op).toBe(existingOp);
  });
});

// =============================================================================
// listDataTokens
// =============================================================================

describe("listDataTokens", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("returns all data tokens", () => {
    const site = {
      components: [],
      dataTokens: [
        { uuid: "dt1", name: "API Key", value: '"abc123"', type: "Data" },
        { uuid: "dt2", name: "Max Items", value: "50", type: "Data" },
      ],
    };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listDataTokens();
    expect(result.tokens).toHaveLength(2);
    expect(result.tokens[0].name).toBe("API Key");
    expect(result.tokens[1].value).toBe("50");
  });

  it("returns empty array when no data tokens", () => {
    const site = { components: [], dataTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listDataTokens();
    expect(result.tokens).toHaveLength(0);
  });
});

// =============================================================================
// createDataToken
// =============================================================================

describe("createDataToken", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("creates a data token with name and value", async () => {
    const site = { components: [], dataTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createDataToken(api, "My Token", '"hello"');
    expect(result.token.name).toBe("My Token");
    expect(mockAddDataToken).toHaveBeenCalled();
    expect(mockAddDataToken.mock.calls[0][0]).toMatchObject({ name: "My Token", value: '"hello"' });
  });

  it("defaults value to null", async () => {
    const site = { components: [], dataTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await createDataToken(api, "Default Token");
    const lastCall = mockAddDataToken.mock.calls[mockAddDataToken.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ value: "null" });
  });
});

// =============================================================================
// updateDataToken
// =============================================================================

describe("updateDataToken", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("updates name and value", async () => {
    const token = { uuid: "dt1", name: "Old Name", value: "null", type: "Data" };
    const site = { components: [], dataTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateDataToken(api, "Old Name", "New Name", '"updated"');
    expect(mockRenameDataToken).toHaveBeenCalled();
    expect(token.value).toBe('"updated"');
  });

  it("throws when neither name nor value provided", async () => {
    const site = { components: [], dataTokens: [{ uuid: "dt1", name: "Token", value: "null", type: "Data" }] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateDataToken(api, "Token")).rejects.toThrow(/at least one/i);
  });

  it("throws when token not found", async () => {
    const site = { components: [], dataTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateDataToken(api, "Nonexistent", "New")).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// removeDataToken
// =============================================================================

describe("removeDataToken", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("removes a data token by name", async () => {
    const token = { uuid: "dt1", name: "Remove Me", value: "null", type: "Data" };
    const site = { components: [], dataTokens: [token] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeDataToken(api, "Remove Me");
    expect(result.removedName).toBe("Remove Me");
    expect(site.dataTokens).toHaveLength(0);
  });

  it("throws when token not found", async () => {
    const site = { components: [], dataTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeDataToken(api, "Nonexistent")).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// getCodeComponentMeta
// =============================================================================

describe("getCodeComponentMeta", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("returns metadata for a code component", () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "CodeButton", tplTree: root });
    comp.type = "code";
    comp.codeComponentMeta = {
      importPath: "@my-lib/button",
      importName: "Button",
      displayName: "My Button",
      description: "A custom button",
      isHostLess: true,
      isContext: false,
      providesData: false,
      hasRef: true,
      isRepeatable: true,
    };
    comp.subComps = [{ name: "ButtonIcon" }, { name: "ButtonLabel" }];
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = getCodeComponentMeta("comp1");
    expect(result.isCodeComponent).toBe(true);
    expect(result.importPath).toBe("@my-lib/button");
    expect(result.importName).toBe("Button");
    expect(result.subComponents).toEqual(["ButtonIcon", "ButtonLabel"]);
  });

  it("returns isCodeComponent: false for regular component", () => {
    const root = mkTag({ uuid: "r1", name: "Root" });
    const comp = mkComponent({ uuid: "comp1", name: "MyComp", tplTree: root });
    const site = { components: [comp] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = getCodeComponentMeta("comp1");
    expect(result.isCodeComponent).toBe(false);
    expect(result.importPath).toBeUndefined();
  });
});

// =============================================================================
// listCustomFunctions
// =============================================================================

describe("listCustomFunctions", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("returns all custom functions", () => {
    const site = {
      components: [],
      customFunctions: [
        {
          importName: "fetchProducts",
          importPath: "@mylib/api",
          namespace: "api",
          displayName: "Fetch Products",
          defaultExport: false,
          isQuery: true,
          params: [
            { argName: "limit", displayName: "Limit", type: { _type: "Num", name: "num" } },
          ],
        },
      ],
    };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listCustomFunctions();
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("fetchProducts");
    expect(result.functions[0].namespace).toBe("api");
    expect(result.functions[0].isQuery).toBe(true);
    expect(result.functions[0].params[0].argName).toBe("limit");
  });

  it("returns empty array when no functions", () => {
    const site = { components: [], customFunctions: [] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listCustomFunctions();
    expect(result.functions).toHaveLength(0);
  });
});

// =============================================================================
// listSplits
// =============================================================================

describe("listSplits", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("returns all splits", () => {
    const site = {
      components: [],
      splits: [
        {
          uuid: "s1", name: "Homepage Test", splitType: "experiment", status: "running",
          slices: [
            { uuid: "sl1", name: "Control", prob: 50 },
            { uuid: "sl2", name: "Variant A", prob: 50 },
          ],
        },
      ],
    };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listSplits();
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0].name).toBe("Homepage Test");
    expect(result.splits[0].slices).toHaveLength(2);
    expect(result.splits[0].slices[0].prob).toBe(50);
  });

  it("returns empty array when no splits", () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listSplits();
    expect(result.splits).toHaveLength(0);
  });
});

// =============================================================================
// createSplit
// =============================================================================

describe("createSplit", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("creates an experiment split with weighted slices", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "CTA Test", "experiment", [
      { name: "Control", prob: 50 },
      { name: "Big Button", prob: 50 },
    ]);
    expect(result.split.name).toBe("CTA Test");
    expect(result.split.splitType).toBe("experiment");
    expect(result.split.slices).toHaveLength(2);
    expect(result.split.slices[0].prob).toBe(50);
  });

  it("creates a segment split", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Region", "segment", [
      { name: "US", cond: '{"country":"US"}' },
      { name: "EU", cond: '{"country":"EU"}' },
    ]);
    expect(result.split.splitType).toBe("segment");
    expect(result.split.slices[0].cond).toBe('{"country":"US"}');
  });

  it("throws when no slices provided", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(createSplit(api, "Empty", "experiment", [])).rejects.toThrow(/At least one/);
  });

  it("auto-calculates equal probabilities when prob not provided", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Even Split", "experiment", [
      { name: "A" },
      { name: "B" },
      { name: "C" },
    ]);
    expect(result.split.slices[0].prob).toBe(33);
  });
});

// =============================================================================
// updateSplit
// =============================================================================

describe("updateSplit", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("updates name and status", async () => {
    const split = { uuid: "s1", name: "Old Name", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Old Name", "New Name", "running");
    expect(result.split.name).toBe("New Name");
    expect(result.split.status).toBe("running");
  });

  it("throws when neither name, status, nor slices provided", async () => {
    const site = { components: [], splits: [{ uuid: "s1", name: "Test", splitType: "experiment", status: "new", slices: [] }] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateSplit(api, "Test")).rejects.toThrow(/at least one/i);
  });

  it("updates slices on an experiment split", async () => {
    const split = { uuid: "s1", name: "AB Test", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "AB Test", undefined, undefined, [
      { name: "Control", prob: 50 },
      { name: "Treatment", prob: 50 },
    ]);
    expect(result.split.slices).toHaveLength(2);
    expect(result.split.slices[0].name).toBe("Control");
    expect(result.split.slices[0].prob).toBe(50);
    expect(result.split.slices[1].name).toBe("Treatment");
    expect(result.split.slices[1].prob).toBe(50);
  });

  it("updates slices on a segment split", async () => {
    const split = { uuid: "s1", name: "Geo Split", splitType: "segment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Geo Split", undefined, undefined, [
      { name: "US", cond: '{"country":"US"}' },
      { name: "EU", cond: '{"region":"EU"}' },
    ]);
    expect(result.split.slices).toHaveLength(2);
    expect(result.split.slices[0].name).toBe("US");
    expect(result.split.slices[0].cond).toBe('{"country":"US"}');
    expect(result.split.slices[1].name).toBe("EU");
  });

  it("updates slices only (no name or status change)", async () => {
    const split = { uuid: "s1", name: "Unchanged", splitType: "experiment", status: "running", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Unchanged", undefined, undefined, [
      { name: "A" },
      { name: "B" },
    ]);
    expect(result.split.name).toBe("Unchanged");
    expect(result.split.status).toBe("running");
    expect(result.split.slices).toHaveLength(2);
  });
});

// =============================================================================
// removeSplit
// =============================================================================

describe("removeSplit", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("removes a split", async () => {
    const split = { uuid: "s1", name: "Old Test", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeSplit(api, "Old Test");
    expect(result.removedName).toBe("Old Test");
    expect(mockRemoveSplit).toHaveBeenCalled();
  });

  it("throws when split not found", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeSplit(api, "Nonexistent")).rejects.toThrow(/not found/);
  });

  it("removes a split by UUID", async () => {
    const split = { uuid: "s1-uuid", name: "By UUID Test", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeSplit(api, "s1-uuid");
    expect(result.removedName).toBe("By UUID Test");
    expect(result.removedUuid).toBe("s1-uuid");
    expect(mockRemoveSplit).toHaveBeenCalledWith(split);
  });

  it("saves changes and returns correct revision", async () => {
    const split = { uuid: "s2", name: "Rev Test", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeSplit(api, "Rev Test");
    expect(result.save.revisionNum).toBe(11);
  });

  it("finds split case-insensitively by name", async () => {
    const split = { uuid: "s3", name: "My Experiment", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeSplit(api, "my experiment");
    expect(result.removedName).toBe("My Experiment");
  });
});

// =============================================================================
// createSplit -- edge cases
// =============================================================================

describe("createSplit -- edge cases", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("single slice experiment gets probability 100", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Solo", "experiment", [{ name: "Only" }]);
    expect(result.split.slices).toHaveLength(1);
    expect(result.split.slices[0].prob).toBe(100);
  });

  it("segment slices get default empty condition when cond not provided", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Default Cond", "segment", [
      { name: "Segment A" },
    ]);
    expect(result.split.slices[0].cond).toBe("{}");
  });

  it("returns status as 'new' for freshly created split", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Fresh", "experiment", [
      { name: "A", prob: 50 },
      { name: "B", prob: 50 },
    ]);
    expect(result.split.status).toBe("new");
  });

  it("generates unique UUIDs for split and each slice", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "UUID Test", "experiment", [
      { name: "A", prob: 50 },
      { name: "B", prob: 50 },
    ]);
    expect(result.split.uuid).toBeTruthy();
    expect(result.split.slices[0].uuid).toBeTruthy();
    expect(result.split.slices[1].uuid).toBeTruthy();
    // All UUIDs should be distinct
    const uuids = [result.split.uuid, result.split.slices[0].uuid, result.split.slices[1].uuid];
    expect(new Set(uuids).size).toBe(3);
  });

  it("saves and returns revision number", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createSplit(api, "Save Test", "experiment", [{ name: "A" }]);
    expect(result.save.revisionNum).toBe(11);
  });
});

// =============================================================================
// updateSplit -- edge cases
// =============================================================================

describe("updateSplit -- edge cases", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => { api = mockApiClient(); });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("updates status only without changing name or slices", async () => {
    const split = { uuid: "s1", name: "Keep Name", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Keep Name", undefined, "running");
    expect(result.split.name).toBe("Keep Name");
    expect(result.split.status).toBe("running");
  });

  it("updates name only without changing status or slices", async () => {
    const split = { uuid: "s1", name: "Old", splitType: "experiment", status: "running", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Old", "New");
    expect(result.split.name).toBe("New");
    expect(result.split.status).toBe("running");
  });

  it("finds split by UUID for update", async () => {
    const split = { uuid: "s1-uuid", name: "By UUID", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "s1-uuid", "Renamed");
    expect(result.split.name).toBe("Renamed");
  });

  it("throws when split not found", async () => {
    const site = { components: [], splits: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(updateSplit(api, "Ghost", "New Name")).rejects.toThrow(/not found/);
  });

  it("auto-calculates equal probabilities when updating slices", async () => {
    const split = { uuid: "s1", name: "Prob Test", splitType: "experiment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Prob Test", undefined, undefined, [
      { name: "A" },
      { name: "B" },
      { name: "C" },
      { name: "D" },
    ]);
    expect(result.split.slices).toHaveLength(4);
    expect(result.split.slices[0].prob).toBe(25);
  });

  it("preserves segment splitType when updating slices", async () => {
    const split = { uuid: "s1", name: "Seg", splitType: "segment", status: "new", slices: [] };
    const site = { components: [], splits: [split] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await updateSplit(api, "Seg", undefined, undefined, [
      { name: "US", cond: '{"country":"US"}' },
    ]);
    expect(result.split.splitType).toBe("segment");
    expect(result.split.slices[0].cond).toBe('{"country":"US"}');
  });
});
