/**
 * Tests for hostless component reachability fix.
 *
 * Verifies that the bundler correctly classifies dependency instances
 * (Components, PropParams from hostless packages) as external references
 * (__xref) rather than internal references (__ref). Incorrect classification
 * causes "Unreachable instance" / "reachable instances not in the bundle"
 * errors from FastBundler.assertFastBundleInvariants().
 *
 * Tests cover:
 * - ensureDependencyAddresses: verifies dep instances have correct bundler addrs
 * - makeIsExternalRef: creates isExternalRef callback for ChangeRecorder
 * - ChangeTracker isExternalRef integration: auto-detects from session
 * - Edge cases: missing addresses, wrong UUIDs, nested hostless components
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  ensureDependencyAddresses,
  makeIsExternalRef,
} from "../bundler-helpers";
import { ChangeTracker, initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { setSession, clearSession } from "../session";
import { mockAddrOf } from "../__mocks__/wab-bundler";
import type { Session } from "../session";

// --- Test fixtures ---

const PROJECT_ID = "proj-uuid-123";
const DEP_PKG_ID = "dep-pkg-uuid-456";
const DEP_PKG_ID_2 = "dep-pkg-uuid-789";

/** Create a mock hostless Component instance (from a dependency package). */
function mkHostlessComponent(name: string, uid: number, params?: any[]): any {
  return {
    _type: "Component",
    uid,
    name,
    params: params ?? [],
    variants: [{ _type: "Variant", uuid: "base-var", name: "base" }],
  };
}

/** Create a mock PropParam instance (from a dependency package). */
function mkHostlessPropParam(name: string, uid: number): any {
  return {
    _type: "PropParam",
    uid,
    variable: { name, uuid: `param-var-${name}` },
    type: { type: "Text" },
  };
}

/** Create a mock SlotParam instance (from a dependency package). */
function mkHostlessSlotParam(name: string, uid: number): any {
  return {
    _type: "SlotParam",
    uid,
    variable: { name, uuid: `slot-var-${name}` },
    tplSlot: true,
    type: { type: "RenderableType" },
  };
}

/** Create a mock TplComponent node referencing a hostless Component. */
function mkTplComponent(
  component: any,
  args?: any[],
  children?: any[]
): any {
  return {
    _type: "TplComponent",
    uuid: `tpl-comp-${Math.random().toString(36).slice(2, 8)}`,
    component,
    name: component.name,
    vsettings: [
      {
        variants: [],
        rs: { values: {} },
        args: args ?? [],
      },
    ],
    children: children ?? [],
  };
}

/** Create a mock Arg referencing a hostless param. */
function mkArg(param: any, value: any): any {
  return {
    _type: "Arg",
    param,
    expr: typeof value === "string"
      ? { _type: "CustomCode", code: JSON.stringify(value), fallback: null }
      : value,
  };
}

/** Create a mock RenderExpr with child Tpl nodes. */
function mkRenderExpr(tpls: any[]): any {
  return {
    _type: "RenderExpr",
    tpl: tpls,
  };
}

/** Create a mock bundler with addrOf support. */
function mkMockBundler(addrMap: Map<number, { uuid: string; iid: string }>) {
  return {
    addrOf: (inst: any) => {
      if (!inst || typeof inst.uid !== "number") return undefined;
      return addrMap.get(inst.uid);
    },
    fastBundle: vi.fn(),
    bundle: vi.fn().mockReturnValue({ map: {}, root: "0" }),
    allUuids: () => [PROJECT_ID, DEP_PKG_ID],
    objByAddr: vi.fn(),
    _uid2addr: addrMap,
    _addr2inst: new Map(),
  };
}

// ============================================================================
// ensureDependencyAddresses
// ============================================================================

describe("ensureDependencyAddresses", () => {
  it("returns true when all dep instances have correct addresses", () => {
    const countParam = mkHostlessPropParam("count", 100);
    const component = mkHostlessComponent("ProductCollection", 200, [countParam]);
    const arg = mkArg(countParam, "8");
    const tpl = mkTplComponent(component, [arg]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(200, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    addrMap.set(100, { uuid: DEP_PKG_ID, iid: "param-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("returns false when a Component has no bundler address", () => {
    const component = mkHostlessComponent("ProductCollection", 300);
    const tpl = mkTplComponent(component);

    // Empty addr map — component not registered
    const bundler = mkMockBundler(new Map());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Component "ProductCollection"')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("has no bundler address")
    );

    consoleErrorSpy.mockRestore();
  });

  it("returns false when a Param has no bundler address", () => {
    const param = mkHostlessPropParam("count", 400);
    const component = mkHostlessComponent("ProductCollection", 500, [param]);
    const arg = mkArg(param, "10");
    const tpl = mkTplComponent(component, [arg]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    // Component IS registered, but param is NOT
    addrMap.set(500, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    const bundler = mkMockBundler(addrMap);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Param "count"')
    );

    consoleErrorSpy.mockRestore();
  });

  it("handles nested hostless components in slot children", () => {
    const innerParam = mkHostlessPropParam("title", 600);
    const innerComponent = mkHostlessComponent("ProductField", 700, [innerParam]);
    const innerTpl = mkTplComponent(innerComponent);

    const slotParam = mkHostlessSlotParam("children", 800);
    const outerComponent = mkHostlessComponent("ProductBox", 900, [slotParam]);
    const slotArg = mkArg(slotParam, mkRenderExpr([innerTpl]));
    const outerTpl = mkTplComponent(outerComponent, [slotArg]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(600, { uuid: DEP_PKG_ID, iid: "inner-param-iid" });
    addrMap.set(700, { uuid: DEP_PKG_ID, iid: "inner-comp-iid" });
    addrMap.set(800, { uuid: DEP_PKG_ID, iid: "slot-param-iid" });
    addrMap.set(900, { uuid: DEP_PKG_ID, iid: "outer-comp-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, outerTpl, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("detects missing address in deeply nested slot children", () => {
    const innerComponent = mkHostlessComponent("ProductField", 1000);
    const innerTpl = mkTplComponent(innerComponent);

    const slotParam = mkHostlessSlotParam("children", 1100);
    const outerComponent = mkHostlessComponent("ProductBox", 1200, [slotParam]);
    const slotArg = mkArg(slotParam, mkRenderExpr([innerTpl]));
    const outerTpl = mkTplComponent(outerComponent, [slotArg]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    // Register outer but NOT inner
    addrMap.set(1100, { uuid: DEP_PKG_ID, iid: "slot-param-iid" });
    addrMap.set(1200, { uuid: DEP_PKG_ID, iid: "outer-comp-iid" });
    const bundler = mkMockBundler(addrMap);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = ensureDependencyAddresses(bundler, outerTpl, PROJECT_ID);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Component "ProductField"')
    );

    consoleErrorSpy.mockRestore();
  });

  it("handles mixed hostless + project-local components", () => {
    // A project-local TplTag containing a hostless TplComponent
    const hostlessComp = mkHostlessComponent("ProductCollection", 1300);
    const hostlessTpl = mkTplComponent(hostlessComp);

    const container = {
      _type: "TplTag",
      uuid: "local-container",
      tag: "div",
      vsettings: [{ variants: [], rs: { values: {} } }],
      children: [hostlessTpl],
    };

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(1300, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, container, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("handles TplTag-only trees (no hostless references)", () => {
    const tpl = {
      _type: "TplTag",
      uuid: "tag-only",
      tag: "div",
      vsettings: [{ variants: [], rs: { values: {} } }],
      children: [],
    };

    const bundler = mkMockBundler(new Map());
    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("handles components from multiple dependency packages", () => {
    const comp1 = mkHostlessComponent("CommerceProduct", 1400);
    const comp2 = mkHostlessComponent("StripeCheckout", 1500);
    const tpl1 = mkTplComponent(comp1);
    const tpl2 = mkTplComponent(comp2);

    const container = {
      _type: "TplTag",
      uuid: "multi-dep-container",
      tag: "div",
      vsettings: [{ variants: [], rs: { values: {} } }],
      children: [tpl1, tpl2],
    };

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(1400, { uuid: DEP_PKG_ID, iid: "comp1-iid" });
    addrMap.set(1500, { uuid: DEP_PKG_ID_2, iid: "comp2-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, container, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("handles component with no params gracefully", () => {
    const component = mkHostlessComponent("EmptyComponent", 1600, []);
    const tpl = mkTplComponent(component);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(1600, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);
    expect(result).toBe(true);
  });

  it("handles component with empty vsettings", () => {
    const component = mkHostlessComponent("NoVariants", 1700);
    const tpl = {
      _type: "TplComponent",
      uuid: "no-vs",
      component,
      name: component.name,
      vsettings: [],
      children: [],
    };

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(1700, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    const bundler = mkMockBundler(addrMap);

    const result = ensureDependencyAddresses(bundler, tpl, PROJECT_ID);
    expect(result).toBe(true);
  });
});

// ============================================================================
// makeIsExternalRef
// ============================================================================

describe("makeIsExternalRef", () => {
  it("returns true for instances with non-project UUID", () => {
    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(42, { uuid: DEP_PKG_ID, iid: "ext-iid" });
    const bundler = mkMockBundler(addrMap);

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef({ uid: 42 })).toBe(true);
  });

  it("returns false for instances with project UUID", () => {
    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(43, { uuid: PROJECT_ID, iid: "proj-iid" });
    const bundler = mkMockBundler(addrMap);

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef({ uid: 43 })).toBe(false);
  });

  it("returns false for instances with no address", () => {
    const bundler = mkMockBundler(new Map());

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef({ uid: 999 })).toBe(false);
  });

  it("returns false for null/undefined objects", () => {
    const bundler = mkMockBundler(new Map());

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef(null)).toBe(false);
    expect(isExternalRef(undefined)).toBe(false);
  });

  it("returns false for objects without uid", () => {
    const bundler = mkMockBundler(new Map());

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef({ name: "test" })).toBe(false);
    expect(isExternalRef("string")).toBe(false);
    expect(isExternalRef(42)).toBe(false);
  });

  it("distinguishes between multiple dependency packages", () => {
    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(1, { uuid: DEP_PKG_ID, iid: "dep1-iid" });
    addrMap.set(2, { uuid: DEP_PKG_ID_2, iid: "dep2-iid" });
    addrMap.set(3, { uuid: PROJECT_ID, iid: "proj-iid" });
    const bundler = mkMockBundler(addrMap);

    const isExternalRef = makeIsExternalRef(bundler, PROJECT_ID);
    expect(isExternalRef({ uid: 1 })).toBe(true);
    expect(isExternalRef({ uid: 2 })).toBe(true);
    expect(isExternalRef({ uid: 3 })).toBe(false);
  });
});

// ============================================================================
// ChangeTracker isExternalRef integration
// ============================================================================

describe("ChangeTracker with isExternalRef", () => {
  afterEach(() => {
    disposeChangeTracker();
    clearSession();
  });

  it("initChangeTracker creates isExternalRef from session", () => {
    const addrMap = new Map<number, { uuid: string; iid: string }>();
    const bundler = mkMockBundler(addrMap);

    setSession({
      projectId: "proj1",
      projectName: "Test",
      site: { components: [] },
      bundler,
      revisionNum: 1,
      modelVersion: 1,
      hostlessDataVersion: 0,
      projectUuid: PROJECT_ID,
      bundleVersion: "test-version",
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tracker = initChangeTracker({ components: [] });

    // Verify the log message indicates isExternalRef was set
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("with isExternalRef")
    );

    consoleErrorSpy.mockRestore();
  });

  it("initChangeTracker works without session (no isExternalRef)", () => {
    // No session set
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tracker = initChangeTracker({ components: [] });

    // Should NOT have isExternalRef
    const calls = consoleErrorSpy.mock.calls.map((c) => c[0]);
    const initMsg = calls.find((c: string) =>
      typeof c === "string" && c.includes("Change tracker initialized")
    );
    expect(initMsg).toBeDefined();
    expect(initMsg).not.toContain("with isExternalRef");

    consoleErrorSpy.mockRestore();
  });

  it("ChangeTracker constructor accepts isExternalRef", () => {
    const isExtRef = vi.fn().mockReturnValue(false);
    const tracker = new ChangeTracker({ components: [] }, isExtRef);

    // Should construct without error
    expect(tracker).toBeDefined();
    tracker.dispose();
  });
});

// ============================================================================
// Bundler address classification scenarios
// ============================================================================

describe("bundler address classification scenarios", () => {
  it("correctly registered dep instance produces valid state", () => {
    // Simulates the normal case after loadProject():
    // dep Component is in _uid2addr with dep UUID
    const component = mkHostlessComponent("ProductCollection", 2000);
    const tpl = mkTplComponent(component);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(2000, { uuid: DEP_PKG_ID, iid: "dep-comp-iid" });
    const bundler = mkMockBundler(addrMap);

    // Verify: addrOf returns dep UUID, not project UUID
    const addr = bundler.addrOf(component);
    expect(addr).toBeDefined();
    expect(addr!.uuid).toBe(DEP_PKG_ID);
    expect(addr!.uuid).not.toBe(PROJECT_ID);

    // ensureDependencyAddresses should pass
    expect(ensureDependencyAddresses(bundler, tpl, PROJECT_ID)).toBe(true);
  });

  it("missing dep instance address is detected", () => {
    // Simulates the failure case: dep Component NOT in _uid2addr
    // If this reached fastBundle(), mkRefAndMaybeVisit would create
    // a wrong address with project UUID
    const component = mkHostlessComponent("ProductCollection", 2100);
    const tpl = mkTplComponent(component);

    const bundler = mkMockBundler(new Map());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(ensureDependencyAddresses(bundler, tpl, PROJECT_ID)).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("multiple params on a hostless component are all verified", () => {
    const param1 = mkHostlessPropParam("count", 2200);
    const param2 = mkHostlessPropParam("category", 2300);
    const slotParam = mkHostlessSlotParam("children", 2400);
    const component = mkHostlessComponent("ProductCollection", 2500, [
      param1, param2, slotParam,
    ]);

    const arg1 = mkArg(param1, "8");
    const arg2 = mkArg(param2, "shoes");
    const tpl = mkTplComponent(component, [arg1, arg2]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(2200, { uuid: DEP_PKG_ID, iid: "p1-iid" });
    addrMap.set(2300, { uuid: DEP_PKG_ID, iid: "p2-iid" });
    addrMap.set(2400, { uuid: DEP_PKG_ID, iid: "slot-iid" });
    addrMap.set(2500, { uuid: DEP_PKG_ID, iid: "comp-iid" });
    const bundler = mkMockBundler(addrMap);

    expect(ensureDependencyAddresses(bundler, tpl, PROJECT_ID)).toBe(true);
  });

  it("cross-package nested components (e.g., commerce + stripe)", () => {
    // Outer: commerce package component
    // Inner: stripe package component in outer's slot
    const innerComp = mkHostlessComponent("StripeCheckout", 2600);
    const innerTpl = mkTplComponent(innerComp);

    const slotParam = mkHostlessSlotParam("children", 2700);
    const outerComp = mkHostlessComponent("CartPage", 2800, [slotParam]);
    const slotArg = mkArg(slotParam, mkRenderExpr([innerTpl]));
    const outerTpl = mkTplComponent(outerComp, [slotArg]);

    const addrMap = new Map<number, { uuid: string; iid: string }>();
    addrMap.set(2600, { uuid: DEP_PKG_ID_2, iid: "stripe-comp-iid" });
    addrMap.set(2700, { uuid: DEP_PKG_ID, iid: "slot-param-iid" });
    addrMap.set(2800, { uuid: DEP_PKG_ID, iid: "cart-comp-iid" });
    const bundler = mkMockBundler(addrMap);

    expect(ensureDependencyAddresses(bundler, outerTpl, PROJECT_ID)).toBe(true);
  });
});
