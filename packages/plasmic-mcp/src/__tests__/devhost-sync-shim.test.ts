/**
 * Tests for the fake-window shim that lets Studio's `CodeComponentsRegistry`
 * read from a serialized `FullRegistryData` (fetched over HTTP from the
 * dev host) without an actual browser window.
 *
 * Studio reads registrations from globals like `window.__PlasmicComponentRegistry`.
 * The MCP doesn't have a window — the shim builds an object with those same
 * globals populated from the JSON registry snapshot, ready to be passed to
 * `new CodeComponentsRegistry(fakeWindow, builtins)`.
 */

import { describe, it, expect } from "vitest";
import { createFakeDevHostWindow } from "../devhost-sync-shim";
import type { FullRegistryData } from "../devhost-sync";

const EMPTY_REGISTRY: FullRegistryData = {
  components: [],
  contexts: [],
  functions: [],
  tokens: [],
  traits: [],
};

describe("createFakeDevHostWindow", () => {
  it("exposes a registered component under __PlasmicComponentRegistry in {component, meta} shape", () => {
    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      components: [
        {
          name: "my-comp",
          displayName: "My Comp",
          props: { label: { type: "string" } },
        },
      ],
    };

    const fakeWin = createFakeDevHostWindow(registry);
    const reg = (fakeWin as any).__PlasmicComponentRegistry;
    expect(Array.isArray(reg)).toBe(true);
    expect(reg).toHaveLength(1);
    expect(reg[0].meta.name).toBe("my-comp");
    expect(reg[0].meta.displayName).toBe("My Comp");
    expect(typeof reg[0].component).toBe("function"); // stub impl
  });

  it("exposes contexts under __PlasmicContextRegistry in {component, meta} shape", () => {
    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      contexts: [
        {
          name: "my-provider",
          displayName: "My Provider",
          props: { apiKey: { type: "string" } },
        },
      ],
    };

    const fakeWin = createFakeDevHostWindow(registry);
    const reg = (fakeWin as any).__PlasmicContextRegistry;
    expect(reg).toHaveLength(1);
    expect(reg[0].meta.name).toBe("my-provider");
    expect(typeof reg[0].component).toBe("function");
  });

  it("exposes tokens and traits as flat arrays; functions as {fn, meta} pairs", () => {
    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      tokens: [{ name: "Primary", type: "color", value: "#FF0000" }],
      traits: [{ trait: "device", meta: { type: "choice", options: ["desktop", "mobile"] } }],
      functions: [{ name: "formatDate", namespace: "dates" }],
    };

    const fakeWin = createFakeDevHostWindow(registry);
    expect((fakeWin as any).__PlasmicTokenRegistry).toEqual(registry.tokens);
    expect((fakeWin as any).__PlasmicTraitRegistry).toEqual(registry.traits);
    // Functions must follow Studio's {fn, meta} shape — `registeredFunctionId`
    // and the whole syncCodeComponents pipeline read `r.meta.namespace` /
    // `r.meta.name`. Flat metas cause "Cannot read properties of undefined
    // (reading 'namespace')" during ingestion.
    const fnReg = (fakeWin as any).__PlasmicFunctionsRegistry;
    expect(fnReg).toHaveLength(1);
    expect(fnReg[0].meta).toEqual(registry.functions[0]);
    expect(typeof fnReg[0].fn).toBe("function");
    expect((fakeWin as any).__PlasmicLibraryRegistry).toEqual([]); // not in FullRegistryData
  });

  it("handles empty registry without throwing", () => {
    const fakeWin = createFakeDevHostWindow(EMPTY_REGISTRY);
    expect((fakeWin as any).__PlasmicComponentRegistry).toEqual([]);
    expect((fakeWin as any).__PlasmicContextRegistry).toEqual([]);
    expect((fakeWin as any).__PlasmicTokenRegistry).toEqual([]);
  });

  it("preserves multiple component entries (Studio de-dupes downstream)", () => {
    const registry: FullRegistryData = {
      ...EMPTY_REGISTRY,
      components: [
        { name: "a", displayName: "A" },
        { name: "a", displayName: "A duplicate" },
        { name: "b" },
      ],
    };
    const fakeWin = createFakeDevHostWindow(registry);
    expect((fakeWin as any).__PlasmicComponentRegistry).toHaveLength(3);
  });
});
