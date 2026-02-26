/**
 * Unit tests for variant domain functions.
 *
 * Extracted from edit-tools.test.ts. Covers:
 *   - resolveVariant
 *   - listVariants
 *   - createStyleVariant
 *   - createVariantGroup
 *   - listGlobalVariantGroups
 *   - createGlobalVariantGroup
 *   - addGlobalVariant
 *   - removeGlobalVariantGroup
 *   - renameGlobalVariant
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  resolveVariant,
  listVariants,
  createStyleVariant,
  createVariantGroup,
  listGlobalVariantGroups,
  createGlobalVariantGroup,
  addGlobalVariant,
  removeGlobalVariantGroup,
  renameGlobalVariant,
} from "../edit-tools";
import { setSession, clearSession } from "../session";
import { initChangeTracker, disposeChangeTracker } from "../change-tracker";
import { clearNodeCache } from "../node-resolver";
import { mockWithRecording } from "../__mocks__/wab-observable-model";
import { mockFastBundle, mockAddrOf } from "../__mocks__/wab-bundler";
import {
  mockCreateStyleVariant,
  mockCreatePrivateStyleVariant,
  mockCreateVariantGroup,
  mockCreateVariant,
  mockCreateGlobalVariantGroup,
  mockCreateGlobalVariant,
  mockRemoveGlobalVariantGroup,
  mockRenameVariant,
} from "../__mocks__/wab-tpl-mgr";
import { mockApiClient, makeSession, mkTag, mkComponent } from "./test-helpers";

// =============================================================================
// edit-tools describe — shared setup (mirrors edit-tools.test.ts lines 842-876)
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

  // --- resolveVariant ---

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

  // --- listVariants ---

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
});

// =============================================================================
// Standalone top-level describes for global variant groups (own setup)
// =============================================================================

describe("listGlobalVariantGroups", () => {
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("returns all global variant groups", () => {
    const site = {
      components: [],
      globalVariantGroups: [
        {
          uuid: "gvg1", param: { variable: { name: "Dark Mode" } },
          type: "global-user-defined", multi: false,
          variants: [{ uuid: "v1", name: "Dark" }, { uuid: "v2", name: "Light" }],
        },
        {
          uuid: "gvg2", param: { variable: { name: "Screen" } },
          type: "global-screen", multi: false,
          variants: [{ uuid: "sv1", name: "Mobile", mediaQuery: "(max-width:768px)" }],
        },
      ],
    };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listGlobalVariantGroups();
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].name).toBe("Dark Mode");
    expect(result.groups[0].variants).toHaveLength(2);
    expect(result.groups[1].variants[0].mediaQuery).toBe("(max-width:768px)");
  });

  it("returns empty array when no groups", () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);

    const result = listGlobalVariantGroups();
    expect(result.groups).toHaveLength(0);
  });
});

describe("createGlobalVariantGroup", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("creates a group with initial variants", async () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createGlobalVariantGroup(api, "Theme", "single", ["Dark", "Light"]);
    expect(mockCreateGlobalVariantGroup).toHaveBeenCalled();
    expect(mockCreateGlobalVariant).toHaveBeenCalledTimes(2);
  });

  it("creates a multi group", async () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await createGlobalVariantGroup(api, "Features", "multi");
    expect(result.group.multi).toBe(true);
  });
});

describe("addGlobalVariant", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("adds a variant to an existing group", async () => {
    const group = {
      uuid: "gvg1", param: { variable: { name: "Theme" } },
      type: "global-user-defined", multi: false, variants: [],
    };
    const site = { components: [], globalVariantGroups: [group] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await addGlobalVariant(api, "Theme", "Dark");
    expect(mockCreateGlobalVariant).toHaveBeenCalled();
    expect(result.variant.name).toBe("Dark");
  });

  it("throws when group not found", async () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(addGlobalVariant(api, "Nonexistent", "V1")).rejects.toThrow(/not found/);
  });
});

describe("removeGlobalVariantGroup", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("removes a group", async () => {
    const group = {
      uuid: "gvg1", param: { variable: { name: "Theme" } },
      type: "global-user-defined", multi: false, variants: [],
    };
    const site = { components: [], globalVariantGroups: [group] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await removeGlobalVariantGroup(api, "Theme");
    expect(result.removedName).toBe("Theme");
    expect(mockRemoveGlobalVariantGroup).toHaveBeenCalled();
  });

  it("throws when group not found", async () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(removeGlobalVariantGroup(api, "Nonexistent")).rejects.toThrow(/not found/);
  });
});

describe("renameGlobalVariant", () => {
  let api: ReturnType<typeof mockApiClient>;
  beforeEach(() => {
    vi.clearAllMocks();
    api = mockApiClient();
    mockFastBundle.mockReturnValue({ map: {}, root: "0" });
    mockAddrOf.mockReturnValue({ uuid: "proj1", iid: "comp-iid-1" });
    mockWithRecording.mockReturnValue({ changes: [], newInsts: [], removedInsts: [] });
  });
  afterEach(() => { clearSession(); disposeChangeTracker(); clearNodeCache(); });

  it("renames a global variant", async () => {
    const group = {
      uuid: "gvg1", param: { variable: { name: "Theme" } },
      type: "global-user-defined", multi: false,
      variants: [{ uuid: "v1", name: "Old Name" }],
    };
    const site = { components: [], globalVariantGroups: [group] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    const result = await renameGlobalVariant(api, "Old Name", "New Name");
    expect(result.oldName).toBe("Old Name");
    expect(mockRenameVariant).toHaveBeenCalled();
  });

  it("throws when variant not found", async () => {
    const site = { components: [], globalVariantGroups: [] };
    const session = makeSession({ site } as any);
    setSession(session);
    initChangeTracker(session.site);

    await expect(renameGlobalVariant(api, "Nonexistent", "New")).rejects.toThrow(/not found/);
  });
});
