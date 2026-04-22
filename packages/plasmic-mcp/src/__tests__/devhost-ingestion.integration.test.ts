/**
 * Tests for the dev-host ingestion orchestrator — the MCP glue that calls
 * Studio's shared `syncCodeComponents` against a fake registry snapshot,
 * absorbing new dev-host components into `site.components`.
 */

import { describe, it, expect, vi } from "vitest";

// Studio's `builtin-code-components.ts` pulls plasmicHeadMeta / FetcherMeta
// from `@plasmicapp/react-web`. Under the integration-test stub those are
// undefined, which cascades into `c.meta.importPath` crashes inside Studio's
// `getBuiltinImportPaths`. The MCP's ingestion path doesn't need those
// built-ins, so mock the module to return an empty bag.
vi.mock("@/wab/shared/code-components/builtin-code-components", () => ({
  getBuiltinComponentRegistrations: () => ({}),
  isBuiltinCodeComponentImportPath: () => false,
  isBuiltinCodeComponent: () => false,
  isBuiltinCodeComponentName: () => false,
  isTplDataFetcher: () => false,
}));

import { createSite } from "@/wab/shared/core/sites";
import { ingestDevHostComponents } from "../devhost-ingestion";
import { syncFromDevHost, clearRegistryCache } from "../devhost-sync";
import type { FullRegistryData } from "../devhost-sync";
import { vi as vi2 } from "vitest"; // alias for scoping below

const EMPTY_REGISTRY: FullRegistryData = {
  components: [],
  contexts: [],
  functions: [],
  tokens: [],
  traits: [],
};

describe("ingestDevHostComponents", () => {
  it("returns an empty IngestionResult when registry is empty and site has no components", async () => {
    const site = createSite();
    const result = await ingestDevHostComponents(site, EMPTY_REGISTRY);

    expect(result.addedComponents).toEqual([]);
    expect(result.removedComponents).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.fatalError).toBeUndefined();
  });

  it("adds a newly-registered code component to site.components", async () => {
    const site = createSite();
    const before = site.components.length;

    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      components: [
        {
          name: "ep-product-provider",
          displayName: "EP Product Provider",
          importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
          importName: "EPProductProvider",
          props: {
            productId: { type: "string" },
          },
        },
      ],
    };

    const result = await ingestDevHostComponents(site, registry);

    expect(result.fatalError).toBeUndefined();
    expect(result.addedComponents).toContain("ep-product-provider");
    expect(site.components.length).toBe(before + 1);
    const added = site.components.find((c: any) => c.name === "ep-product-provider");
    expect(added).toBeTruthy();
    expect(added.params.some((p: any) => p.variable.name === "productId")).toBe(true);
  });

  it("returns a fatalError and leaves site untouched when the registry has duplicate names", async () => {
    const site = createSite();
    const before = site.components.length;

    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      components: [
        {
          name: "collider",
          displayName: "First",
          importPath: "@pkg/a",
          importName: "First",
          props: {},
        },
        {
          name: "collider",
          displayName: "Second",
          importPath: "@pkg/b",
          importName: "Second",
          props: {},
        },
      ],
    };

    const result = await ingestDevHostComponents(site, registry);

    expect(result.fatalError).toBeDefined();
    expect(result.fatalError?.code).toBe("DuplicateCodeComponentError");
    expect(result.addedComponents).toEqual([]);
    expect(site.components.length).toBe(before);
  });

  it("syncFromDevHost in syncMode='full' populates result.ingestion with added components", async () => {
    const site = createSite();
    const before = site.components.length;

    const registryResponse = {
      components: [
        {
          name: "via-http-sync",
          displayName: "Via HTTP",
          importPath: "@pkg/http",
          importName: "ViaHttp",
          props: {},
        },
      ],
      contexts: [],
      functions: [],
      tokens: [],
      traits: [],
    };

    clearRegistryCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(registryResponse),
    }) as any;

    const result = await syncFromDevHost(site, "http://localhost:3388", {
      syncMode: "full",
    });

    expect(result.devHostSynced).toBe(true);
    expect(result.ingestion).toBeDefined();
    expect(result.ingestion!.addedComponents).toContain("via-http-sync");
    expect(site.components.length).toBe(before + 1);
  });

  it("syncFromDevHost in syncMode='variants-only' does NOT call ingestion", async () => {
    const site = createSite();
    const before = site.components.length;

    clearRegistryCache();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          components: [
            {
              name: "should-not-be-ingested",
              importPath: "@pkg/skip",
              importName: "Skip",
              props: {},
            },
          ],
          contexts: [],
          functions: [],
          tokens: [],
          traits: [],
        }),
    }) as any;

    const result = await syncFromDevHost(site, "http://localhost:3388", {
      syncMode: "variants-only",
    });

    expect(result.devHostSynced).toBe(true);
    expect(result.ingestion).toBeUndefined();
    expect(site.components.length).toBe(before); // not ingested
  });

  it("preserves components in site.components when dropped from the registry (non-destructive)", async () => {
    const site = createSite();

    // First pass: add a component.
    await ingestDevHostComponents(site, {
      ...EMPTY_REGISTRY,
      components: [
        {
          name: "ep-keep-me",
          displayName: "Keep Me",
          importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
          importName: "KeepMe",
          props: {},
        },
      ],
    });
    const afterFirst = site.components.find((c: any) => c.name === "ep-keep-me");
    expect(afterFirst).toBeTruthy();
    const countAfterFirst = site.components.length;

    // Second pass: remove that registration from the incoming registry.
    // Studio's fixMissingCodeComponents should preserve the component
    // (not auto-delete) and our callbacks should surface a warning.
    const second = await ingestDevHostComponents(site, EMPTY_REGISTRY);

    // Still in the site
    expect(site.components.find((c: any) => c.name === "ep-keep-me")).toBeTruthy();
    // No delete reflected in diff
    expect(second.removedComponents).toEqual([]);
    // But the user should be warned
    expect(
      second.warnings.some(
        (w: any) => w.code === "missing-component" && w.componentName === "ep-keep-me"
      )
    ).toBe(true);
    // No change in overall component count
    expect(site.components.length).toBe(countAfterFirst);
  });
});
