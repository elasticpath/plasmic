/**
 * Tests for the human review flagging logic (P3.2).
 *
 * Why these tests matter: review flags determine which scenarios surface in
 * the human review queue. False negatives (missing flags) mean reviewers miss
 * important disagreements; false positives flood the queue with noise.
 * These tests verify all three flag criteria work correctly in isolation
 * and in combination.
 */

import { describe, it, expect } from "vitest";
import {
  computeReviewFlags,
  applyReviewFlags,
} from "../../evals/graders/review-flags.js";
import type {
  ScenarioResult,
  EvalReport,
} from "../../evals/harness/types.js";

/** Helper to create a minimal ScenarioResult for testing */
function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id: "test-scenario",
    tier: "simple",
    domains: ["component"],
    success: true,
    qualityScore: null,
    toolCalls: 3,
    tokensInput: 1000,
    tokensOutput: 500,
    durationMs: 5000,
    errors: [],
    retries: 0,
    transcript: [],
    graderResults: [],
    ...overrides,
  };
}

/** Helper to create a minimal EvalReport for testing previous-run detection */
function makeReport(
  scenarioIds: string[],
  overrides: Partial<EvalReport> = {}
): EvalReport {
  return {
    runId: "2026-02-26-120000",
    timestamp: "2026-02-26T12:00:00.000Z",
    tier: "mock",
    model: "claude-sonnet-4-20250514",
    scenarios: scenarioIds.map((id) => makeResult({ id })),
    aggregate: {
      total: scenarioIds.length,
      passed: scenarioIds.length,
      failed: 0,
      timedOut: 0,
      successRate: 1,
      meanToolCalls: 3,
      meanDurationMs: 5000,
      meanTokensInput: 1000,
      meanTokensOutput: 500,
      meanQualityScore: null,
      totalCostDollars: 0,
      needsReview: 0,
      byDomain: {},
      byTier: {},
    },
    ...overrides,
  };
}

describe("computeReviewFlags", () => {
  describe("judge-disagrees flag", () => {
    it("flags when state passes but judge scores <= 2", () => {
      const result = makeResult({ success: true, qualityScore: 2 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
    });

    it("flags when state passes but judge scores 1", () => {
      const result = makeResult({ success: true, qualityScore: 1 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
    });

    it("flags when state fails but judge scores >= 4", () => {
      const result = makeResult({ success: false, qualityScore: 4 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
    });

    it("flags when state fails but judge scores 5", () => {
      const result = makeResult({ success: false, qualityScore: 5 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
    });

    it("does NOT flag when state and judge agree (pass + score 4)", () => {
      const result = makeResult({ success: true, qualityScore: 4 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("judge-disagrees");
    });

    it("does NOT flag when state and judge agree (fail + score 2)", () => {
      const result = makeResult({ success: false, qualityScore: 2 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("judge-disagrees");
    });

    it("does NOT flag when quality score is null (no judge)", () => {
      const result = makeResult({ success: true, qualityScore: null });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("judge-disagrees");
    });

    it("does NOT flag for score 3 (borderline, neither high nor low)", () => {
      const result = makeResult({ success: true, qualityScore: 3 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("judge-disagrees");
    });
  });

  describe("low-quality flag", () => {
    it("flags when quality score is 1", () => {
      const result = makeResult({ success: false, qualityScore: 1 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("low-quality");
    });

    it("flags when quality score is 2 and state fails", () => {
      const result = makeResult({ success: false, qualityScore: 2 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("low-quality");
    });

    it("P13.7: flags low-quality even when success=true and score<=2", () => {
      // Before P13.7 fix, success=true + score=1 would get judge-disagrees
      // but NOT low-quality because the guard on line 55 skipped it.
      const result = makeResult({ success: true, qualityScore: 1 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
      expect(flags).toContain("low-quality");
    });

    it("P13.7: flags low-quality alongside judge-disagrees for success=true, score=2", () => {
      const result = makeResult({ success: true, qualityScore: 2 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("judge-disagrees");
      expect(flags).toContain("low-quality");
    });

    it("does NOT flag when quality score is 3", () => {
      const result = makeResult({ success: true, qualityScore: 3 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("low-quality");
    });

    it("does NOT flag when quality score is null", () => {
      const result = makeResult({ success: true, qualityScore: null });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("low-quality");
    });
  });

  describe("new-scenario flag", () => {
    it("flags when scenario is not in previous run", () => {
      const result = makeResult({ id: "new-scenario" });
      const previousIds = new Set(["old-scenario-1", "old-scenario-2"]);
      const flags = computeReviewFlags(result, previousIds);
      expect(flags).toContain("new-scenario");
    });

    it("does NOT flag when scenario exists in previous run", () => {
      const result = makeResult({ id: "existing-scenario" });
      const previousIds = new Set(["existing-scenario", "other-scenario"]);
      const flags = computeReviewFlags(result, previousIds);
      expect(flags).not.toContain("new-scenario");
    });

    it("does NOT flag when no previous IDs provided (first run)", () => {
      const result = makeResult({ id: "any-scenario" });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("new-scenario");
    });

    it("does NOT flag when previous IDs is undefined", () => {
      const result = makeResult({ id: "any-scenario" });
      const flags = computeReviewFlags(result, undefined);
      expect(flags).not.toContain("new-scenario");
    });
  });

  describe("regression flag (P14.6)", () => {
    it("flags when scenario was passing but now fails", () => {
      const result = makeResult({ id: "regressed", success: false });
      const previousSuccess = new Map([["regressed", true]]);
      const flags = computeReviewFlags(result, undefined, previousSuccess);
      expect(flags).toContain("regression");
    });

    it("does NOT flag when scenario was already failing", () => {
      const result = makeResult({ id: "still-failing", success: false });
      const previousSuccess = new Map([["still-failing", false]]);
      const flags = computeReviewFlags(result, undefined, previousSuccess);
      expect(flags).not.toContain("regression");
    });

    it("does NOT flag when scenario still passes", () => {
      const result = makeResult({ id: "still-passing", success: true });
      const previousSuccess = new Map([["still-passing", true]]);
      const flags = computeReviewFlags(result, undefined, previousSuccess);
      expect(flags).not.toContain("regression");
    });

    it("does NOT flag for new scenarios (not in previous)", () => {
      const result = makeResult({ id: "new-scenario", success: false });
      const previousSuccess = new Map([["other", true]]);
      const flags = computeReviewFlags(result, undefined, previousSuccess);
      expect(flags).not.toContain("regression");
    });

    it("does NOT flag when previousScenarioSuccess is undefined", () => {
      const result = makeResult({ id: "any", success: false });
      const flags = computeReviewFlags(result, undefined, undefined);
      expect(flags).not.toContain("regression");
    });
  });

  describe("high-retries flag (P14.7)", () => {
    it("flags when scenario passes with retries > 3", () => {
      const result = makeResult({ success: true, retries: 4 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("high-retries");
    });

    it("flags when scenario passes with retries = 5", () => {
      const result = makeResult({ success: true, retries: 5 });
      const flags = computeReviewFlags(result);
      expect(flags).toContain("high-retries");
    });

    it("does NOT flag when retries <= 3", () => {
      const result = makeResult({ success: true, retries: 3 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("high-retries");
    });

    it("does NOT flag when retries = 0", () => {
      const result = makeResult({ success: true, retries: 0 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("high-retries");
    });

    it("does NOT flag when scenario fails (even with high retries)", () => {
      const result = makeResult({ success: false, retries: 10 });
      const flags = computeReviewFlags(result);
      expect(flags).not.toContain("high-retries");
    });
  });

  describe("combined flags", () => {
    it("can have multiple flags simultaneously", () => {
      const result = makeResult({
        id: "new-failing-scenario",
        success: false,
        qualityScore: 5,
      });
      const previousIds = new Set(["other-scenario"]);
      const flags = computeReviewFlags(result, previousIds);
      expect(flags).toContain("judge-disagrees");
      expect(flags).toContain("new-scenario");
    });

    it("returns empty array when no flags apply", () => {
      const result = makeResult({ success: true, qualityScore: 4 });
      const previousIds = new Set(["test-scenario"]);
      const flags = computeReviewFlags(result, previousIds);
      expect(flags).toEqual([]);
    });

    it("regression and new-scenario are mutually exclusive", () => {
      // A scenario can't regress if it's new (not in previous run)
      const result = makeResult({ id: "brand-new", success: false });
      const previousIds = new Set(["other"]);
      const previousSuccess = new Map([["other", true]]);
      const flags = computeReviewFlags(result, previousIds, previousSuccess);
      expect(flags).toContain("new-scenario");
      expect(flags).not.toContain("regression");
    });

    it("regression and high-retries cannot coexist (high-retries requires success)", () => {
      const result = makeResult({ id: "regressed", success: false, retries: 10 });
      const previousSuccess = new Map([["regressed", true]]);
      const flags = computeReviewFlags(result, undefined, previousSuccess);
      expect(flags).toContain("regression");
      expect(flags).not.toContain("high-retries");
    });
  });
});

describe("applyReviewFlags", () => {
  it("sets needsReview and reviewFlags on flagged scenarios", () => {
    const results = [
      makeResult({ id: "s1", success: true, qualityScore: 1 }),
      makeResult({ id: "s2", success: true, qualityScore: 5 }),
    ];

    applyReviewFlags(results);

    expect(results[0].needsReview).toBe(true);
    expect(results[0].reviewFlags).toContain("judge-disagrees");
    expect(results[1].needsReview).toBe(false);
    expect(results[1].reviewFlags).toEqual([]);
  });

  it("returns count of flagged scenarios", () => {
    const results = [
      makeResult({ id: "s1", success: true, qualityScore: 1 }),
      makeResult({ id: "s2", success: true, qualityScore: 5 }),
      makeResult({ id: "s3", success: false, qualityScore: 5 }),
    ];

    const count = applyReviewFlags(results);
    // s1 gets judge-disagrees + low-quality (P13.7), s3 gets judge-disagrees
    expect(count).toBe(2);
  });

  it("uses previous report for new-scenario detection", () => {
    const results = [
      makeResult({ id: "existing-scenario" }),
      makeResult({ id: "brand-new-scenario" }),
    ];

    const previousReport = makeReport(["existing-scenario"]);
    applyReviewFlags(results, previousReport);

    expect(results[0].needsReview).toBe(false);
    expect(results[1].needsReview).toBe(true);
    expect(results[1].reviewFlags).toContain("new-scenario");
  });

  it("handles null previousReport (first run)", () => {
    const results = [makeResult({ id: "s1" })];
    const count = applyReviewFlags(results, null);
    expect(count).toBe(0);
    expect(results[0].needsReview).toBe(false);
  });

  it("handles undefined previousReport", () => {
    const results = [makeResult({ id: "s1" })];
    const count = applyReviewFlags(results, undefined);
    expect(count).toBe(0);
    expect(results[0].needsReview).toBe(false);
  });

  it("mutates results in place", () => {
    const results = [
      makeResult({ id: "new-scenario" }),
    ];
    const previousReport = makeReport(["other-scenario"]);

    applyReviewFlags(results, previousReport);

    // Verify the original array was mutated
    expect(results[0].needsReview).toBe(true);
    expect(results[0].reviewFlags).toContain("new-scenario");
  });

  it("P14.6: detects regression from previous report", () => {
    const results = [
      makeResult({ id: "s1", success: false }), // was passing, now fails
      makeResult({ id: "s2", success: true }),   // still passing
    ];

    // Previous report has s1 passing
    const previousReport = makeReport(["s1", "s2"]);

    applyReviewFlags(results, previousReport);

    expect(results[0].needsReview).toBe(true);
    expect(results[0].reviewFlags).toContain("regression");
    expect(results[1].needsReview).toBe(false);
  });

  it("P14.7: flags high-retries via applyReviewFlags", () => {
    const results = [
      makeResult({ id: "fragile", success: true, retries: 5 }),
      makeResult({ id: "stable", success: true, retries: 1 }),
    ];

    applyReviewFlags(results);

    expect(results[0].needsReview).toBe(true);
    expect(results[0].reviewFlags).toContain("high-retries");
    expect(results[1].needsReview).toBe(false);
  });
});
