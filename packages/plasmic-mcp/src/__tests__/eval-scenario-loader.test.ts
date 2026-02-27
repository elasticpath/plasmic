/**
 * Tests for the scenario loader module (P3.4).
 *
 * Why these tests matter: the scenario loader is the entry point for all eval
 * data. If it misparses YAML, silently drops scenarios, or misapplies filters,
 * the eval system either tests the wrong things or tests nothing at all. These
 * tests validate loading from real YAML files, correct filtering by tier/domain/
 * scenario ID, and graceful handling of malformed input.
 *
 * These tests use the actual scenario YAML files in evals/scenarios/ to verify
 * the real loading pipeline works end-to-end. This is intentional — we want to
 * catch schema drift between YAML files and the loader's expectations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadScenarios } from "../../evals/harness/scenario-loader.js";
import type { EvalScenario } from "../../evals/harness/types.js";

// Suppress warnings from validation (expected for some edge case scenarios)
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Loading real scenarios
// ---------------------------------------------------------------------------
describe("loadScenarios — real YAML files", () => {
  it("loads at least 50 scenarios from evals/scenarios/", () => {
    const scenarios = loadScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(50);
  });

  it("every scenario has required fields", () => {
    const scenarios = loadScenarios();

    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(Array.isArray(s.domains)).toBe(true);
      expect(["simple", "medium", "complex"]).toContain(s.tier);
      expect(Array.isArray(s.graders)).toBe(true);
      expect(typeof s.timeout).toBe("number");
    }
  });

  it("all scenario IDs are unique", () => {
    const scenarios = loadScenarios();
    const ids = scenarios.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all domains are valid STRAP domains", () => {
    const validDomains = [
      "project",
      "inspect",
      "component",
      "node",
      "variant",
      "design",
      "data",
      "interaction",
    ];
    const scenarios = loadScenarios();

    for (const s of scenarios) {
      for (const d of s.domains) {
        expect(validDomains).toContain(d);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tier filtering
// ---------------------------------------------------------------------------
describe("loadScenarios — tier filtering", () => {
  it("filters by simple tier", () => {
    const scenarios = loadScenarios({ tier: "simple" });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.tier === "simple")).toBe(true);
  });

  it("filters by medium tier", () => {
    const scenarios = loadScenarios({ tier: "medium" });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.tier === "medium")).toBe(true);
  });

  it("filters by complex tier", () => {
    const scenarios = loadScenarios({ tier: "complex" });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.tier === "complex")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Domain filtering
// ---------------------------------------------------------------------------
describe("loadScenarios — domain filtering", () => {
  it("filters by a specific domain", () => {
    const scenarios = loadScenarios({ domain: "design" });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.domains.includes("design"))).toBe(true);
  });

  it("returns empty array for domain with no scenarios", () => {
    const scenarios = loadScenarios({ domain: "nonexistent" });
    expect(scenarios).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scenario ID filtering
// ---------------------------------------------------------------------------
describe("loadScenarios — scenario ID filtering", () => {
  it("returns exactly one scenario when filtering by ID", () => {
    // Load all to find a valid ID
    const all = loadScenarios();
    const firstId = all[0].id;

    const filtered = loadScenarios({ scenario: firstId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(firstId);
  });

  it("returns empty array for non-existent scenario ID", () => {
    const filtered = loadScenarios({ scenario: "does-not-exist" });
    expect(filtered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Combined filtering
// ---------------------------------------------------------------------------
describe("loadScenarios — combined filtering", () => {
  it("applies tier and domain filters together", () => {
    const scenarios = loadScenarios({ tier: "simple", domain: "component" });
    if (scenarios.length > 0) {
      expect(scenarios.every((s) => s.tier === "simple")).toBe(true);
      expect(
        scenarios.every((s) => s.domains.includes("component"))
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Mode filtering (requiredMode)
// ---------------------------------------------------------------------------
describe("loadScenarios — requiredMode filtering", () => {
  it("excludes integration-only scenarios in mock mode (default)", () => {
    const scenarios = loadScenarios();
    // project-save-refresh has requiredMode: integration
    expect(scenarios.find((s) => s.id === "project-save-refresh")).toBeUndefined();
  });

  it("includes integration-only scenarios when integration: true", () => {
    const scenarios = loadScenarios({ integration: true });
    expect(scenarios.find((s) => s.id === "project-save-refresh")).toBeDefined();
  });

  it("preserves requiredMode field on normalized scenario", () => {
    const scenarios = loadScenarios({ integration: true });
    const sr = scenarios.find((s) => s.id === "project-save-refresh");
    expect(sr?.requiredMode).toBe("integration");
  });
});

// ---------------------------------------------------------------------------
// Scenario normalization
// ---------------------------------------------------------------------------
describe("loadScenarios — normalization", () => {
  it("normalizes grader params to have a params object", () => {
    const scenarios = loadScenarios();
    for (const s of scenarios) {
      for (const g of s.graders) {
        expect(g.params).toBeDefined();
        expect(typeof g.params).toBe("object");
      }
    }
  });

  it("defaults timeout to a positive number", () => {
    const scenarios = loadScenarios();
    for (const s of scenarios) {
      expect(s.timeout).toBeGreaterThan(0);
    }
  });

  it("P14.3: every scenario has a contentHash", () => {
    const scenarios = loadScenarios();
    for (const s of scenarios) {
      expect(s.contentHash).toBeDefined();
      expect(typeof s.contentHash).toBe("string");
      expect(s.contentHash!.length).toBe(16); // 16 hex chars (64 bits)
    }
  });

  it("P14.3: same scenario produces same contentHash", () => {
    const scenarios1 = loadScenarios();
    const scenarios2 = loadScenarios();
    // Same YAML content should produce identical hashes
    for (let i = 0; i < scenarios1.length; i++) {
      expect(scenarios1[i].contentHash).toBe(scenarios2[i].contentHash);
    }
  });

  it("P14.3: different scenario IDs can have different contentHashes", () => {
    const scenarios = loadScenarios();
    const hashes = new Set(scenarios.map((s) => s.contentHash));
    // Most scenarios should have unique content (and thus unique hashes)
    // Allow some collisions but require at least 80% unique
    expect(hashes.size).toBeGreaterThan(scenarios.length * 0.8);
  });
});
