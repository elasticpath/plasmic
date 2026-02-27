/**
 * Unit tests for devhost-sync.ts — Dev Host Variant Sync.
 *
 * Tests the three core functions:
 * - fetchDevHostRegistry(): HTTP fetch with timeout, error handling
 * - syncVariantMetadata(): populates codeComponentMeta.variants on matching code components
 * - ensureVariantObjects(): creates Variant objects on wrapper components
 * - syncFromDevHost(): full orchestration
 *
 * Uses globalThis.fetch mocking (no real network calls).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchDevHostRegistry,
  syncVariantMetadata,
  ensureVariantObjects,
  syncFromDevHost,
} from "../devhost-sync";

// Suppress console.error in tests
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helper: create a mock site model ---

function mkCodeComponent(name: string, variants?: Record<string, any>) {
  return {
    name,
    codeComponentMeta: {
      variants: variants ?? {},
    },
    variants: [],
    tplTree: { _type: "TplTag" }, // not a TplComponent (this IS the code component)
  };
}

function mkWrapperComponent(
  name: string,
  codeComp: any,
  existingVariants: any[] = []
) {
  return {
    name,
    codeComponentMeta: undefined, // wrappers are not code components themselves
    variants: [
      // Base variant is always first
      { uuid: "base-uuid", name: "base" },
      ...existingVariants,
    ],
    tplTree: {
      _type: "TplComponent",
      component: codeComp, // reference to the code component
    },
  };
}

function mkSite(components: any[]) {
  return { components };
}

// --- fetchDevHostRegistry tests ---

describe("fetchDevHostRegistry", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns parsed components on successful fetch", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [
            {
              name: "MyButton",
              variants: {
                pressed: { cssSelector: ":active", displayName: "Pressed" },
              },
            },
          ],
        }),
    }) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe("MyButton");
    expect(result![0].variants!.pressed.cssSelector).toBe(":active");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3388/api/plasmic-registry",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns null and logs warning on network error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED")
    );
  });

  it("returns null and logs warning on timeout (AbortError)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(abortError) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("aborted")
    );
  });

  it("returns null and logs warning on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("404")
    );
  });

  it("returns null on malformed JSON response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "wrong shape" }),
    }) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("malformed")
    );
  });

  it("returns null on JSON parse error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("invalid json")),
    }) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result).toBeNull();
  });

  it("normalizes trailing slashes in host URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ components: [] }),
    }) as any;

    await fetchDevHostRegistry("http://localhost:3388///");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3388/api/plasmic-registry",
      expect.any(Object)
    );
  });
});

// --- syncVariantMetadata tests ---

describe("syncVariantMetadata", () => {
  it("populates codeComponentMeta.variants on matching code components", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const synced = syncVariantMetadata(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: {
            cssSelector: "[data-selected]",
            displayName: "Selected",
          },
        },
      },
    ]);

    expect(synced).toEqual(["EPButton$dev"]);
    expect(cc.codeComponentMeta.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
  });

  it("skips components not in the site model", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const synced = syncVariantMetadata(site, [
      {
        name: "NonExistent",
        variants: {
          active: { cssSelector: ":active", displayName: "Active" },
        },
      },
    ]);

    expect(synced).toEqual([]);
  });

  it("handles $dev suffix matching", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    // Registry has name without $dev
    const synced = syncVariantMetadata(site, [
      {
        name: "EPButton",
        variants: {
          hovered: { cssSelector: ":hover", displayName: "Hovered" },
        },
      },
    ]);

    expect(synced).toEqual(["EPButton$dev"]);
    expect(cc.codeComponentMeta.variants).toEqual({
      hovered: { cssSelector: ":hover", displayName: "Hovered" },
    });
  });

  it("handles reverse $dev suffix matching (site has base, registry has $dev)", () => {
    const cc = mkCodeComponent("EPButton");
    const site = mkSite([cc]);

    const synced = syncVariantMetadata(site, [
      {
        name: "EPButton$dev",
        variants: {
          pressed: { cssSelector: ":active", displayName: "Pressed" },
        },
      },
    ]);

    expect(synced).toEqual(["EPButton"]);
  });

  it("overwrites existing variant metadata (dev host is source of truth)", () => {
    const cc = mkCodeComponent("EPButton$dev", {
      old: { cssSelector: ".old", displayName: "Old" },
    });
    const site = mkSite([cc]);

    syncVariantMetadata(site, [
      {
        name: "EPButton$dev",
        variants: {
          new: { cssSelector: ".new", displayName: "New" },
        },
      },
    ]);

    expect(cc.codeComponentMeta.variants).toEqual({
      new: { cssSelector: ".new", displayName: "New" },
    });
    expect(cc.codeComponentMeta.variants).not.toHaveProperty("old");
  });

  it("skips components without variants in the registry", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const synced = syncVariantMetadata(site, [
      { name: "EPButton$dev" },
      { name: "EPButton$dev", variants: {} },
    ]);

    expect(synced).toEqual([]);
  });

  it("syncs multiple components", () => {
    const cc1 = mkCodeComponent("CompA$dev");
    const cc2 = mkCodeComponent("CompB$dev");
    const site = mkSite([cc1, cc2]);

    const synced = syncVariantMetadata(site, [
      {
        name: "CompA$dev",
        variants: { a: { cssSelector: ".a", displayName: "A" } },
      },
      {
        name: "CompB$dev",
        variants: { b: { cssSelector: ".b", displayName: "B" } },
      },
    ]);

    expect(synced).toEqual(["CompA$dev", "CompB$dev"]);
  });
});

// --- ensureVariantObjects tests ---

describe("ensureVariantObjects", () => {
  it("creates Variant objects on wrapper components", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper = mkWrapperComponent("Button Wrapper", cc);
    const site = mkSite([cc, wrapper]);

    ensureVariantObjects(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: {
            cssSelector: "[data-selected]",
            displayName: "Selected",
          },
        },
      },
    ]);

    // Should have base + new variant
    expect(wrapper.variants).toHaveLength(2);
    const ccVariant = wrapper.variants[1];
    expect(ccVariant.name).toBe("");
    expect(ccVariant.codeComponentName).toBe("EPButton$dev");
    expect(ccVariant.codeComponentVariantKeys).toEqual(["selected"]);
    expect(ccVariant.uuid).toBeTruthy();
  });

  it("does not duplicate existing variants", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const existingVariant = {
      uuid: "existing-uuid",
      name: "",
      codeComponentName: "EPButton$dev",
      codeComponentVariantKeys: ["selected"],
    };
    const wrapper = mkWrapperComponent("Button Wrapper", cc, [
      existingVariant,
    ]);
    const site = mkSite([cc, wrapper]);

    ensureVariantObjects(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: {
            cssSelector: "[data-selected]",
            displayName: "Selected",
          },
        },
      },
    ]);

    // Should still have base + existing variant only (no duplicate)
    expect(wrapper.variants).toHaveLength(2);
    expect(wrapper.variants[1].uuid).toBe("existing-uuid");
  });

  it("creates variants on multiple wrappers referencing same code component", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper1 = mkWrapperComponent("Wrapper 1", cc);
    const wrapper2 = mkWrapperComponent("Wrapper 2", cc);
    const site = mkSite([cc, wrapper1, wrapper2]);

    ensureVariantObjects(site, [
      {
        name: "EPButton$dev",
        variants: {
          active: { cssSelector: ":active", displayName: "Active" },
        },
      },
    ]);

    expect(wrapper1.variants).toHaveLength(2);
    expect(wrapper2.variants).toHaveLength(2);
    expect(wrapper1.variants[1].codeComponentVariantKeys).toEqual(["active"]);
    expect(wrapper2.variants[1].codeComponentVariantKeys).toEqual(["active"]);
  });

  it("creates multiple variants for multiple keys", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper = mkWrapperComponent("Wrapper", cc);
    const site = mkSite([cc, wrapper]);

    ensureVariantObjects(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: {
            cssSelector: "[data-selected]",
            displayName: "Selected",
          },
          disabled: { cssSelector: ":disabled", displayName: "Disabled" },
          hovered: { cssSelector: ":hover", displayName: "Hovered" },
        },
      },
    ]);

    // base + 3 new variants
    expect(wrapper.variants).toHaveLength(4);
    const keys = wrapper.variants
      .slice(1)
      .map((v: any) => v.codeComponentVariantKeys[0]);
    expect(keys).toContain("selected");
    expect(keys).toContain("disabled");
    expect(keys).toContain("hovered");
  });

  it("created Variant has correct shape", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper = mkWrapperComponent("Wrapper", cc);
    const site = mkSite([cc, wrapper]);

    ensureVariantObjects(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: {
            cssSelector: "[data-selected]",
            displayName: "Selected",
          },
        },
      },
    ]);

    const variant = wrapper.variants[1];
    expect(variant).toMatchObject({
      name: "",
      codeComponentName: "EPButton$dev",
      codeComponentVariantKeys: ["selected"],
    });
    expect(typeof variant.uuid).toBe("string");
    expect(variant.uuid.length).toBeGreaterThan(0);
  });
});

// --- syncFromDevHost tests ---

describe("syncFromDevHost", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("skips sync when hostUrl is null/undefined", async () => {
    const site = mkSite([]);

    const result = await syncFromDevHost(site, undefined);
    expect(result.devHostSynced).toBe(false);
    expect(result.syncedVariantComponents).toEqual([]);

    const result2 = await syncFromDevHost(site, "");
    expect(result2.devHostSynced).toBe(false);
  });

  it("returns devHostSynced=false when fetch fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as any;
    const site = mkSite([]);

    const result = await syncFromDevHost(site, "http://localhost:3388");
    expect(result.devHostSynced).toBe(false);
  });

  it("returns devHostSynced=true with empty list when no variant-bearing components", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [{ name: "PlainComp", props: {} }],
        }),
    }) as any;
    const site = mkSite([]);

    const result = await syncFromDevHost(site, "http://localhost:3388");
    expect(result.devHostSynced).toBe(true);
    expect(result.syncedVariantComponents).toEqual([]);
  });

  it("full sync flow: fetch → filter → sync metadata → create variants", async () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper = mkWrapperComponent("Button Card", cc);
    const site = mkSite([cc, wrapper]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [
            { name: "PlainComp" },
            {
              name: "EPButton$dev",
              variants: {
                selected: {
                  cssSelector: "[data-selected]",
                  displayName: "Selected",
                },
              },
            },
          ],
        }),
    }) as any;

    const result = await syncFromDevHost(site, "http://localhost:3388");

    // Sync result
    expect(result.devHostSynced).toBe(true);
    expect(result.syncedVariantComponents).toEqual(["EPButton$dev"]);

    // Variant metadata populated
    expect(cc.codeComponentMeta.variants).toEqual({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });

    // Variant object created on wrapper
    expect(wrapper.variants).toHaveLength(2);
    expect(wrapper.variants[1].codeComponentVariantKeys).toEqual(["selected"]);
  });
});
