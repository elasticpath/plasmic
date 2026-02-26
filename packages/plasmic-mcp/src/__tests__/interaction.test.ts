/**
 * Interaction domain tests.
 *
 * Tests for listInteractions, addInteraction, and removeInteraction.
 * Extracted from edit-tools.test.ts — all assertions preserved exactly.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  listInteractions,
  addInteraction,
  removeInteraction,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import { mockEnsureBaseVariantSetting } from "../__mocks__/wab-tpl-mgr";
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

// =============================================================================
// listInteractions — reading event handler interactions from elements
// =============================================================================

describe("listInteractions", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
    mockWithRecording.mockReturnValue({
      changes: [], newInsts: [], removedInsts: [],
    });
  });

  afterEach(() => {
    clearSession();
    disposeChangeTracker();
    clearNodeCache();
  });

  it("returns empty array when no event handlers exist", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toEqual([]);
  });

  it("lists interactions from an onClick handler", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Navigate",
            actionName: "navigation",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "destination",
                expr: { _type: "CustomCode", code: '"/about"', fallback: null },
              },
            ],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      index: 0,
      uuid: "int-1",
      event: "onClick",
      actionName: "navigation",
      interactionName: "Navigate",
      conditionalMode: "always",
      args: { destination: '"/about"' },
    });
  });

  it("lists multiple interactions across multiple events", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Step 1",
            actionName: "customFunction",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "customFunction",
                expr: {
                  _type: "FunctionExpr",
                  argNames: ["$steps"],
                  bodyExpr: { _type: "CustomCode", code: "console.log('hi')", fallback: null },
                },
              },
            ],
          },
        ],
      },
      onMouseEnter: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-2",
            interactionName: "Hover action",
            actionName: "updateVariable",
            conditionalMode: "always",
            condExpr: null,
            args: [
              {
                _type: "NameArg",
                name: "variable",
                expr: { _type: "ObjectPath", path: ["$state", "isHovered"], fallback: null },
              },
            ],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe("onClick");
    expect(result[0].args).toEqual({ customFunction: "console.log('hi')" });
    expect(result[1].event).toBe("onMouseEnter");
    expect(result[1].args).toEqual({ variable: "$state.isHovered" });
  });

  it("extracts condition expression from condExpr", () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "int-1",
            interactionName: "Conditional",
            actionName: "navigation",
            conditionalMode: "expression",
            condExpr: { _type: "CustomCode", code: "$state.isLoggedIn", fallback: null },
            args: [],
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = listInteractions(comp, "root-1");
    expect(result[0].condition).toBe("$state.isLoggedIn");
    expect(result[0].conditionalMode).toBe("expression");
  });

  it("throws when target is not a TplTag", () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} } }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    expect(() => listInteractions(comp, "comp-inst-1")).toThrow(/non-TplTag|TplComponent/);
  });
});

// =============================================================================
// addInteraction — adding event handler interactions to elements
// =============================================================================

describe("addInteraction", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
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

  it("adds a navigation interaction to onClick", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/about" }
    );

    expect(result.event).toBe("onClick");
    expect(result.actionName).toBe("navigation");
    expect(result.interactionUuid).toBeTruthy();

    // Handler should be created on attrs
    const handler = root.vsettings[0].attrs.onClick;
    expect(handler._type).toBe("EventHandler");
    expect(handler.interactions).toHaveLength(1);
    expect(handler.interactions[0].actionName).toBe("navigation");
    expect(handler.interactions[0].args[0].name).toBe("destination");
  });

  it("adds an updateVariable interaction with aliases", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "setState",
      { variable: "isOpen", value: "!$state.isOpen" }
    );

    expect(result.actionName).toBe("updateVariable");
    const handler = root.vsettings[0].attrs.onClick;
    const interaction = handler.interactions[0];
    expect(interaction.actionName).toBe("updateVariable");

    // Check args: variable, operation, value
    const argNames = interaction.args.map((a: any) => a.name);
    expect(argNames).toContain("variable");
    expect(argNames).toContain("operation");
    expect(argNames).toContain("value");

    // variable arg should be ObjectPath
    const varArg = interaction.args.find((a: any) => a.name === "variable");
    expect(varArg.expr._type).toBe("ObjectPath");
    expect(varArg.expr.path).toEqual(["$state", "isOpen"]);
  });

  it("adds a customFunction interaction", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "runCode",
      { code: "alert('hello')" }
    );

    expect(result.actionName).toBe("customFunction");
    const interaction = root.vsettings[0].attrs.onClick.interactions[0];
    const codeArg = interaction.args.find((a: any) => a.name === "customFunction");
    expect(codeArg.expr._type).toBe("FunctionExpr");
    expect(codeArg.expr.bodyExpr._type).toBe("CustomCode");
    expect(codeArg.expr.bodyExpr.code).toBe("alert('hello')");
  });

  it("appends to existing EventHandler interactions", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          {
            _type: "Interaction",
            uuid: "existing-1",
            interactionName: "First",
            actionName: "navigation",
            args: [],
            condExpr: null,
            conditionalMode: "always",
            parent: null,
          },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addInteraction(
      api, "comp-1", "root-1", "onClick", "runCode",
      { code: "console.log(1)" }
    );

    const handler = root.vsettings[0].attrs.onClick;
    expect(handler.interactions).toHaveLength(2);
    expect(handler.interactions[0].uuid).toBe("existing-1");
    expect(handler.interactions[1].actionName).toBe("customFunction");
  });

  it("adds condition expression when provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/home" },
      "Go home",
      "$state.isLoggedIn"
    );

    const interaction = root.vsettings[0].attrs.onClick.interactions[0];
    expect(interaction.interactionName).toBe("Go home");
    expect(interaction.conditionalMode).toBe("expression");
    expect(interaction.condExpr._type).toBe("CustomCode");
    expect(interaction.condExpr.code).toBe("$state.isLoggedIn");
  });

  it("generates default interaction name when not provided", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addInteraction(
      api, "comp-1", "root-1", "onClick", "navigation",
      { destination: "/about" }
    );

    expect(result.interactionName).toContain("onClick");
    expect(result.interactionName).toContain("navigation");
  });

  it("rejects unknown event name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onBogus", "navigation", { destination: "/" })
    ).rejects.toThrow(/Unknown event/);
  });

  it("rejects unknown action name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "doSomething", {})
    ).rejects.toThrow(/Unknown action/);
  });

  it("rejects interaction on non-TplTag node", async () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} }, attrs: {} }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "comp-inst-1", "onClick", "navigation", { destination: "/" })
    ).rejects.toThrow(/non-TplTag|TplComponent/);
  });

  it("rejects navigation without destination", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "navigation", {})
    ).rejects.toThrow(/destination/);
  });

  it("rejects updateVariable without variable name", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "updateVariable", { value: "true" })
    ).rejects.toThrow(/variable/);
  });

  it("rejects customFunction without code", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      addInteraction(api, "comp-1", "root-1", "onClick", "customFunction", {})
    ).rejects.toThrow(/code/);
  });
});

// =============================================================================
// removeInteraction — removing event handler interactions from elements
// =============================================================================

describe("removeInteraction", () => {
  let api: ReturnType<typeof mockApiClient>;

  beforeEach(() => {
    api = mockApiClient();
    mockEnsureBaseVariantSetting.mockImplementation((tpl: any) => tpl.vsettings[0]);
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

  it("removes a specific interaction by index", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", actionName: "navigation", args: [] },
          { _type: "Interaction", uuid: "int-2", actionName: "customFunction", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeInteraction(api, "comp-1", "root-1", "onClick", 0);
    expect(result.removedCount).toBe(1);

    const handler = root.vsettings[0].attrs.onClick;
    expect(handler.interactions).toHaveLength(1);
    expect(handler.interactions[0].uuid).toBe("int-2");
  });

  it("removes all interactions when no index specified", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
          { _type: "Interaction", uuid: "int-2", args: [] },
          { _type: "Interaction", uuid: "int-3", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeInteraction(api, "comp-1", "root-1", "onClick");
    expect(result.removedCount).toBe(3);

    // Handler itself should be removed from attrs when empty
    expect(root.vsettings[0].attrs.onClick).toBeUndefined();
  });

  it("cleans up empty handler from attrs", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await removeInteraction(api, "comp-1", "root-1", "onClick", 0);
    expect(root.vsettings[0].attrs.onClick).toBeUndefined();
  });

  it("throws when event has no handler", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {};
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "root-1", "onClick")
    ).rejects.toThrow(/No event handler/);
  });

  it("throws when interaction index is out of range", async () => {
    const root = mkTag({ uuid: "root-1" });
    root.vsettings[0].attrs = {
      onClick: {
        _type: "EventHandler",
        interactions: [
          { _type: "Interaction", uuid: "int-1", args: [] },
        ],
      },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "root-1", "onClick", 5)
    ).rejects.toThrow(/out of range/);
  });

  it("throws when target is not a TplTag", async () => {
    const root = {
      _type: "TplComponent",
      uuid: "comp-inst-1",
      vsettings: [{ rs: { values: {} }, attrs: {} }],
      children: [],
      component: { uuid: "other" },
    };
    const comp = mkComponent({ uuid: "comp-1", tplTree: root });
    const site = { components: [comp], styleTokens: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(
      removeInteraction(api, "comp-1", "comp-inst-1", "onClick")
    ).rejects.toThrow(/non-TplTag|TplComponent/);
  });
});
