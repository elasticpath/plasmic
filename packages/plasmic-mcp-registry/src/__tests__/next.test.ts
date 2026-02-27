/**
 * Tests for withPlasmicRegistry() — the Next.js config wrapper.
 *
 * Why: If the wrapper fails to detect packages or adds them incorrectly,
 * Next.js will either fail to build (missing externals) or throw RSC
 * boundary errors when the API route imports component registration code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Mock fs and path so we don't depend on actual filesystem
vi.mock("fs");
vi.mock("path");

import { withPlasmicRegistry } from "../next";

describe("withPlasmicRegistry", () => {
  const mockPackageJson = {
    dependencies: {
      "@plasmicpkgs/commerce": "0.0.232",
      "@plasmicpkgs/fetch": "0.0.24",
      "@plasmicpkgs/plasmic-basic-components": "0.0.263",
      "@elasticpath/plasmic-mcp-registry": "0.2.0",
      "@plasmicapp/host": "1.0.0",
      "next": "^15.5.3",
      "react": "^19",
    },
    devDependencies: {
      "@plasmicpkgs/graphql": "0.0.18",
      "@elasticpath/plasmic-other": "1.0.0",
      "vitest": "^2.1.0",
    },
  };

  beforeEach(() => {
    vi.mocked(path.resolve).mockReturnValue("/fake/path/package.json");
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify(mockPackageJson)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-detects @plasmicpkgs/* packages from dependencies", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toContain("@plasmicpkgs/commerce");
    expect(result.serverExternalPackages).toContain("@plasmicpkgs/fetch");
    expect(result.serverExternalPackages).toContain(
      "@plasmicpkgs/plasmic-basic-components"
    );
  });

  it("auto-detects @elasticpath/plasmic-* packages", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toContain(
      "@elasticpath/plasmic-mcp-registry"
    );
    expect(result.serverExternalPackages).toContain(
      "@elasticpath/plasmic-other"
    );
  });

  it("auto-detects @plasmicapp/host", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toContain("@plasmicapp/host");
  });

  it("detects packages from devDependencies", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toContain("@plasmicpkgs/graphql");
  });

  it("does not include non-Plasmic packages", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).not.toContain("next");
    expect(result.serverExternalPackages).not.toContain("react");
    expect(result.serverExternalPackages).not.toContain("vitest");
  });

  it("merges with existing serverExternalPackages (no duplicates)", () => {
    const result = withPlasmicRegistry({
      serverExternalPackages: [
        "@plasmicpkgs/commerce",
        "some-other-pkg",
      ],
    });

    expect(result.serverExternalPackages).toContain("some-other-pkg");
    expect(result.serverExternalPackages).toContain("@plasmicpkgs/commerce");

    // No duplicates
    const occurrences = result.serverExternalPackages!.filter(
      (p) => p === "@plasmicpkgs/commerce"
    );
    expect(occurrences).toHaveLength(1);
  });

  it("handles empty config input", () => {
    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toBeDefined();
    expect(Array.isArray(result.serverExternalPackages)).toBe(true);
    expect(result.serverExternalPackages!.length).toBeGreaterThan(0);
  });

  it("handles no config argument (defaults to empty)", () => {
    const result = withPlasmicRegistry();
    expect(result.serverExternalPackages).toBeDefined();
  });

  it("passes through all other config keys unchanged", () => {
    const result = withPlasmicRegistry({
      reactStrictMode: true,
      experimental: { turbo: true },
      images: { domains: ["example.com"] },
    });

    expect(result.reactStrictMode).toBe(true);
    expect(result.experimental).toEqual({ turbo: true });
    expect(result.images).toEqual({ domains: ["example.com"] });
  });

  it("returns config with empty serverExternalPackages when no Plasmic packages found", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        dependencies: { next: "^15", react: "^19" },
        devDependencies: { vitest: "^2" },
      })
    );

    const result = withPlasmicRegistry({});
    expect(result.serverExternalPackages).toEqual([]);
  });

  it("warns and continues when package.json cannot be read", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });

    const result = withPlasmicRegistry({ reactStrictMode: true });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not read package.json")
    );
    expect(result.serverExternalPackages).toEqual([]);
    expect(result.reactStrictMode).toBe(true);

    warnSpy.mockRestore();
  });
});
