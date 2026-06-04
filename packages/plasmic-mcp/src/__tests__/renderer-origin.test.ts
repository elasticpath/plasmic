/**
 * Unit tests for renderer-origin resolution.
 */

import { describe, it, expect } from "vitest";
import { deriveRendererOrigin, RENDERER_ORIGIN_FALLBACK } from "../renderer-origin.js";

describe("deriveRendererOrigin", () => {
  it("uses the env override when set, stripping a trailing slash", () => {
    expect(
      deriveRendererOrigin("https://my.host.example.com/", undefined)
    ).toBe("https://my.host.example.com");
  });

  it("derives the origin from the app-config defaultHostUrl", () => {
    // Studio returns a full host.html URL; we want just the origin.
    expect(
      deriveRendererOrigin(
        undefined,
        "https://host.elasticpathdev.com/static/host.html"
      )
    ).toBe("https://host.elasticpathdev.com");
  });

  it("preserves an environment/region prefix from defaultHostUrl", () => {
    expect(
      deriveRendererOrigin(
        undefined,
        "https://useast.host.elasticpathdev.com/static/host.html"
      )
    ).toBe("https://useast.host.elasticpathdev.com");
  });

  it("prefers the env override over the app-config value", () => {
    expect(
      deriveRendererOrigin(
        "https://override.example.com",
        "https://useast.host.elasticpathdev.com/static/host.html"
      )
    ).toBe("https://override.example.com");
  });

  it("falls back when neither override nor app-config is available", () => {
    expect(deriveRendererOrigin(undefined, undefined)).toBe(
      RENDERER_ORIGIN_FALLBACK
    );
  });

  it("falls back when the app-config URL is malformed", () => {
    expect(deriveRendererOrigin(undefined, "not a url")).toBe(
      RENDERER_ORIGIN_FALLBACK
    );
  });

  it("honors a custom fallback", () => {
    expect(
      deriveRendererOrigin(undefined, undefined, "https://fallback.example.com/")
    ).toBe("https://fallback.example.com");
  });
});
