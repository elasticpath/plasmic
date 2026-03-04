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
  clearRegistryCache,
  deepEqualVariants,
  recordVariantMetadataSync,
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
    // Clear cache between tests to prevent cross-test interference
    clearRegistryCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns FullRegistryData with components on successful fetch", async () => {
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
    expect(result).not.toBeNull();
    expect(result!.components).toHaveLength(1);
    expect(result!.components[0].name).toBe("MyButton");
    expect(result!.components[0].variants!.pressed.cssSelector).toBe(":active");
    // Non-component registries default to [] when not in response
    expect(result!.contexts).toEqual([]);
    expect(result!.functions).toEqual([]);
    expect(result!.tokens).toEqual([]);
    expect(result!.traits).toEqual([]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://localhost:3388/api/plasmic-registry",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns full FullRegistryData when all five registries present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [{ name: "Btn" }],
          contexts: [{ name: "ThemeCtx" }],
          functions: [{ name: "fetchData" }],
          tokens: [{ name: "primary", value: "#000", type: "color" }],
          traits: [{ trait: "size", meta: { type: "choice", options: ["sm", "lg"] } }],
        }),
    }) as any;

    const result = await fetchDevHostRegistry("http://localhost:3388");
    expect(result!.components).toHaveLength(1);
    expect(result!.contexts).toHaveLength(1);
    expect(result!.contexts[0]).toEqual({ name: "ThemeCtx" });
    expect(result!.functions).toHaveLength(1);
    expect(result!.tokens).toHaveLength(1);
    expect(result!.traits).toHaveLength(1);
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

// --- TTL cache tests ---

describe("fetchDevHostRegistry cache", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    clearRegistryCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns cached data on second call within TTL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ components: [{ name: "Cached" }] }),
    });
    globalThis.fetch = mockFetch as any;

    const result1 = await fetchDevHostRegistry("http://localhost:3388");
    const result2 = await fetchDevHostRegistry("http://localhost:3388");

    expect(result1!.components[0].name).toBe("Cached");
    expect(result2!.components[0].name).toBe("Cached");
    // Only one network call — second was served from cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses separate cache entries for different hostUrls", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ components: [{ name: `Comp${callCount}` }] }),
      });
    }) as any;

    const result1 = await fetchDevHostRegistry("http://localhost:3388");
    const result2 = await fetchDevHostRegistry("http://localhost:3389");

    expect(result1!.components[0].name).toBe("Comp1");
    expect(result2!.components[0].name).toBe("Comp2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("clearRegistryCache(hostUrl) clears only that entry", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ components: [{ name: "X" }] }),
    });
    globalThis.fetch = mockFetch as any;

    await fetchDevHostRegistry("http://localhost:3388");
    await fetchDevHostRegistry("http://localhost:3389");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Clear only 3388
    clearRegistryCache("http://localhost:3388");

    await fetchDevHostRegistry("http://localhost:3388"); // should re-fetch
    await fetchDevHostRegistry("http://localhost:3389"); // should use cache
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("clearRegistryCache() with no args clears all entries", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ components: [{ name: "X" }] }),
    });
    globalThis.fetch = mockFetch as any;

    await fetchDevHostRegistry("http://localhost:3388");
    await fetchDevHostRegistry("http://localhost:3389");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    clearRegistryCache(); // clear all

    await fetchDevHostRegistry("http://localhost:3388");
    await fetchDevHostRegistry("http://localhost:3389");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("does not cache failed fetches (null results)", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("network fail"))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ components: [{ name: "Recovered" }] }),
      });
    globalThis.fetch = mockFetch as any;

    const result1 = await fetchDevHostRegistry("http://localhost:3388");
    expect(result1).toBeNull();

    const result2 = await fetchDevHostRegistry("http://localhost:3388");
    expect(result2!.components[0].name).toBe("Recovered");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("respects PLASMIC_REGISTRY_CACHE_TTL_MS env variable", async () => {
    // Set TTL to 0 to effectively disable caching
    process.env.PLASMIC_REGISTRY_CACHE_TTL_MS = "0";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ components: [{ name: "X" }] }),
    });
    globalThis.fetch = mockFetch as any;

    await fetchDevHostRegistry("http://localhost:3388");
    await fetchDevHostRegistry("http://localhost:3388");

    // Both calls should hit the network since TTL=0
    expect(mockFetch).toHaveBeenCalledTimes(2);

    delete process.env.PLASMIC_REGISTRY_CACHE_TTL_MS;
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
    expect(cc.codeComponentMeta.variants).toMatchObject({
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
    expect(cc.codeComponentMeta.variants).toMatchObject({
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

    expect(cc.codeComponentMeta.variants).toMatchObject({
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

  it("handles malformed variant entries gracefully (non-object values)", () => {
    const cc = mkCodeComponent("BrokenComp$dev");
    const site = mkSite([cc]);

    // Registry contains malformed data: string instead of { cssSelector, displayName }
    const synced = syncVariantMetadata(site, [
      {
        name: "BrokenComp$dev",
        variants: {
          good: { cssSelector: ".good", displayName: "Good" },
          bad: "not-an-object" as any,
          worse: null as any,
        },
      },
    ]);

    expect(synced).toEqual(["BrokenComp$dev"]);
    // The good variant is synced, malformed ones are skipped
    expect(cc.codeComponentMeta.variants).toHaveProperty("good");
    expect(cc.codeComponentMeta.variants.good).toMatchObject({
      cssSelector: ".good",
      displayName: "Good",
    });
    // Malformed entries should not be present
    expect(cc.codeComponentMeta.variants).not.toHaveProperty("bad");
    expect(cc.codeComponentMeta.variants).not.toHaveProperty("worse");
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
    clearRegistryCache();
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

  it("full sync flow: fetch → filter → sync metadata (no eager variant creation)", async () => {
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

    // syncFromDevHost does NOT write variant metadata to the model.
    // That's done by recordVariantMetadataSync inside a recording context
    // so the changes are tracked for incremental saves.
    expect(cc.codeComponentMeta.variants).toEqual({});

    // Variant objects are NOT eagerly created on wrappers during sync.
    // They are created on-demand inside ChangeRecorder.withRecording()
    // when a tool handler (e.g. update-styles) references them.
    expect(wrapper.variants).toHaveLength(1); // only base variant
  });

  it("includes registryData in result when sync succeeds", async () => {
    const cc = mkCodeComponent("EPButton$dev");
    const wrapper = mkWrapperComponent("Wrapper", cc);
    const site = mkSite([cc, wrapper]);

    const registryResponse = {
      components: [
        {
          name: "EPButton$dev",
          variants: {
            selected: { cssSelector: "[data-selected]", displayName: "Selected" },
          },
        },
      ],
      contexts: [{ name: "ShopContext", importPath: "@pkg/shop" }],
      functions: [{ name: "formatPrice", importPath: "@pkg/utils" }],
      tokens: [{ name: "Primary", value: "#ff0000", type: "Color" }],
      traits: [{ trait: "interactive", meta: { type: "boolean" } }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(registryResponse),
    }) as any;

    const result = await syncFromDevHost(site, "http://localhost:3388");

    expect(result.devHostSynced).toBe(true);
    expect(result.registryData).not.toBeUndefined();
    expect(result.registryData!.components).toHaveLength(1);
    expect(result.registryData!.contexts).toHaveLength(1);
    expect(result.registryData!.contexts[0]).toEqual({ name: "ShopContext", importPath: "@pkg/shop" });
    expect(result.registryData!.functions).toHaveLength(1);
    expect(result.registryData!.tokens).toHaveLength(1);
    expect(result.registryData!.traits).toHaveLength(1);
  });

  it("includes registryData even when no variant-bearing components", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [{ name: "PlainComp" }],
          contexts: [{ name: "ThemeContext" }],
          functions: [],
          tokens: [{ name: "Accent", value: "#00ff00", type: "Color" }],
          traits: [],
        }),
    }) as any;

    const site = mkSite([]);
    const result = await syncFromDevHost(site, "http://localhost:3388");

    expect(result.devHostSynced).toBe(true);
    expect(result.syncedVariantComponents).toEqual([]);
    expect(result.registryData).not.toBeUndefined();
    expect(result.registryData!.contexts).toHaveLength(1);
    expect(result.registryData!.tokens).toHaveLength(1);
  });

  it("returns registryData=undefined when fetch fails", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const site = mkSite([]);
    const result = await syncFromDevHost(site, "http://localhost:3388");

    expect(result.devHostSynced).toBe(false);
    expect(result.registryData).toBeUndefined();
  });

  it("returns registryData=undefined when hostUrl is empty", async () => {
    const site = mkSite([]);
    const result = await syncFromDevHost(site, undefined);

    expect(result.registryData).toBeUndefined();
  });
});

// --- deepEqualVariants tests ---

describe("deepEqualVariants", () => {
  it("returns true for identical metadata", () => {
    const a = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    const b = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    expect(deepEqualVariants(a, b)).toBe(true);
  });

  it("returns false when cssSelector differs", () => {
    const a = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    const b = { selected: { cssSelector: "[data-active]", displayName: "Selected" } };
    expect(deepEqualVariants(a, b)).toBe(false);
  });

  it("returns false when displayName differs", () => {
    const a = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    const b = { selected: { cssSelector: "[data-selected]", displayName: "Active" } };
    expect(deepEqualVariants(a, b)).toBe(false);
  });

  it("returns false when keys differ", () => {
    const a = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    const b = { active: { cssSelector: "[data-selected]", displayName: "Selected" } };
    expect(deepEqualVariants(a, b)).toBe(false);
  });

  it("returns false when key counts differ", () => {
    const a = { selected: { cssSelector: "[data-selected]", displayName: "Selected" } };
    const b = {
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
      disabled: { cssSelector: ":disabled", displayName: "Disabled" },
    };
    expect(deepEqualVariants(a, b)).toBe(false);
  });

  it("returns true for empty maps", () => {
    expect(deepEqualVariants({}, {})).toBe(true);
  });

  it("returns true when a is undefined and b is empty", () => {
    expect(deepEqualVariants(undefined, {})).toBe(true);
  });

  it("returns false when a is undefined and b has entries", () => {
    expect(deepEqualVariants(undefined, { x: { cssSelector: ".x", displayName: "X" } })).toBe(false);
  });

  it("handles multiple keys in sorted order", () => {
    const a = {
      disabled: { cssSelector: ":disabled", displayName: "Disabled" },
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    };
    const b = {
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
      disabled: { cssSelector: ":disabled", displayName: "Disabled" },
    };
    expect(deepEqualVariants(a, b)).toBe(true);
  });
});

// --- recordVariantMetadataSync tests ---

describe("recordVariantMetadataSync", () => {
  it("writes metadata when it differs from current", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ]);

    expect(updated).toEqual(["EPButton$dev"]);
    expect(cc.codeComponentMeta.variants).toMatchObject({
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
  });

  it("skips write when metadata is already identical", () => {
    const cc = mkCodeComponent("EPButton$dev", {
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
    const site = mkSite([cc]);

    // Store reference to check it wasn't replaced
    const originalVariants = cc.codeComponentMeta.variants;

    const updated = recordVariantMetadataSync(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ]);

    expect(updated).toEqual([]);
    // Same object reference — no write occurred
    expect(cc.codeComponentMeta.variants).toBe(originalVariants);
  });

  it("writes when cssSelector changed", () => {
    const cc = mkCodeComponent("EPButton$dev", {
      selected: { cssSelector: ".old-selector", displayName: "Selected" },
    });
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ]);

    expect(updated).toEqual(["EPButton$dev"]);
    expect(cc.codeComponentMeta.variants.selected.cssSelector).toBe("[data-selected]");
  });

  it("writes when new variant key added", () => {
    const cc = mkCodeComponent("EPButton$dev", {
      selected: { cssSelector: "[data-selected]", displayName: "Selected" },
    });
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "EPButton$dev",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
          disabled: { cssSelector: ":disabled", displayName: "Disabled" },
        },
      },
    ]);

    expect(updated).toEqual(["EPButton$dev"]);
  });

  it("handles $dev suffix matching", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "EPButton",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ]);

    expect(updated).toEqual(["EPButton$dev"]);
  });

  it("skips components not in site model", () => {
    const site = mkSite([]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "NonExistent",
        variants: {
          selected: { cssSelector: "[data-selected]", displayName: "Selected" },
        },
      },
    ]);

    expect(updated).toEqual([]);
  });

  it("skips components without variants", () => {
    const cc = mkCodeComponent("EPButton$dev");
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      { name: "EPButton$dev" },
      { name: "EPButton$dev", variants: {} },
    ]);

    expect(updated).toEqual([]);
  });

  it("handles malformed variant entries (non-object values)", () => {
    const cc = mkCodeComponent("BrokenComp$dev");
    const site = mkSite([cc]);

    const updated = recordVariantMetadataSync(site, [
      {
        name: "BrokenComp$dev",
        variants: {
          good: { cssSelector: ".good", displayName: "Good" },
          bad: "not-an-object" as any,
        },
      },
    ]);

    expect(updated).toEqual(["BrokenComp$dev"]);
    expect(cc.codeComponentMeta.variants).toHaveProperty("good");
    expect(cc.codeComponentMeta.variants).not.toHaveProperty("bad");
  });
});
