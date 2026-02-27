/**
 * Tests for the eval reporter module (P3.5).
 *
 * Why these tests matter: the reporter is the final stage of the eval pipeline.
 * It transforms raw scenario results into aggregate statistics that CI uses for
 * pass/fail decisions. If aggregation is wrong (e.g., success rate miscounted),
 * CI may silently pass with failing evals or block valid PRs. These tests verify
 * report structure, stat computation, review flag integration, and output format.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScenarioResult, EvalReport } from "../../evals/harness/types.js";

// Mock fs, child_process, and review-flags before importing reporter
vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../evals/graders/review-flags.js", () => ({
  applyReviewFlags: vi.fn(() => 0),
}));

// Import after mocks
const { generateRunId, generateReport, loadPreviousReport, getGitSha, findPassedScenarioIds } =
  await import("../../evals/harness/reporter.js");
const { applyReviewFlags } = await import(
  "../../evals/graders/review-flags.js"
);
const fs = await import("fs");
const childProcess = await import("child_process");

/** Helper to create a minimal ScenarioResult */
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

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock implementation — vi.clearAllMocks() only clears call history,
  // not custom implementations. Without this, a mockImplementation set in one
  // test persists to subsequent tests and crashes on different input shapes.
  (applyReviewFlags as any).mockImplementation(() => 0);
});

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------
describe("generateRunId", () => {
  it("formats date as YYYY-MM-DD-HHmmss", () => {
    const date = new Date("2026-02-26T14:30:45.000Z");
    const runId = generateRunId(date);
    // Timezone-dependent, but the format pattern should be consistent
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it("pads single-digit months and days", () => {
    const date = new Date("2026-01-05T09:05:03.000Z");
    const runId = generateRunId(date);
    expect(runId).toMatch(/^\d{4}-0\d-0\d-\d{6}$/);
  });

  it("uses current time when no date provided", () => {
    const runId = generateRunId();
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });
});

// ---------------------------------------------------------------------------
// generateReport — aggregate stats
// ---------------------------------------------------------------------------
describe("generateReport — aggregate stats", () => {
  it("computes correct pass/fail/timeout counts", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", success: true }),
      makeResult({ id: "s2", success: false, errors: ["Some error"] }),
      makeResult({ id: "s3", success: false, errors: ["Scenario timed out"] }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");

    expect(report.aggregate.total).toBe(3);
    expect(report.aggregate.passed).toBe(1);
    expect(report.aggregate.failed).toBe(1);
    expect(report.aggregate.timedOut).toBe(1);
  });

  it("computes success rate correctly", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", success: true }),
      makeResult({ id: "s2", success: true }),
      makeResult({ id: "s3", success: false }),
      makeResult({ id: "s4", success: false }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");
    expect(report.aggregate.successRate).toBe(0.5);
  });

  it("handles empty results array", () => {
    const report = generateReport([], "claude-sonnet", "mock");

    expect(report.aggregate.total).toBe(0);
    expect(report.aggregate.passed).toBe(0);
    expect(report.aggregate.successRate).toBe(0);
    expect(report.aggregate.meanToolCalls).toBe(0);
  });

  it("computes mean metrics correctly", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", toolCalls: 4, durationMs: 2000, tokensInput: 100, tokensOutput: 50 }),
      makeResult({ id: "s2", toolCalls: 6, durationMs: 4000, tokensInput: 300, tokensOutput: 150 }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");

    expect(report.aggregate.meanToolCalls).toBe(5);
    expect(report.aggregate.meanDurationMs).toBe(3000);
    expect(report.aggregate.meanTokensInput).toBe(200);
    expect(report.aggregate.meanTokensOutput).toBe(100);
  });

  it("preserves totalCostDollars", () => {
    const report = generateReport(
      [makeResult()],
      "claude-sonnet",
      "mock",
      1.234
    );
    expect(report.aggregate.totalCostDollars).toBe(1.234);
  });
});

// ---------------------------------------------------------------------------
// generateReport — quality scores
// ---------------------------------------------------------------------------
describe("generateReport — quality scores", () => {
  it("computes mean quality score from non-null values", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", qualityScore: 4 }),
      makeResult({ id: "s2", qualityScore: null }),
      makeResult({ id: "s3", qualityScore: 2 }),
    ];

    const report = generateReport(results, "claude-sonnet", "integration");
    expect(report.aggregate.meanQualityScore).toBe(3);
  });

  it("returns null meanQualityScore when no quality scores exist", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", qualityScore: null }),
      makeResult({ id: "s2", qualityScore: null }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");
    expect(report.aggregate.meanQualityScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateReport — domain/tier breakdown
// ---------------------------------------------------------------------------
describe("generateReport — domain breakdown", () => {
  it("computes per-domain stats correctly", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", domains: ["component", "node"], success: true }),
      makeResult({ id: "s2", domains: ["component"], success: false }),
      makeResult({ id: "s3", domains: ["design"], success: true }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");

    expect(report.aggregate.byDomain.component.total).toBe(2);
    expect(report.aggregate.byDomain.component.passed).toBe(1);
    expect(report.aggregate.byDomain.component.successRate).toBe(0.5);
    expect(report.aggregate.byDomain.node.total).toBe(1);
    expect(report.aggregate.byDomain.node.passed).toBe(1);
    expect(report.aggregate.byDomain.design.total).toBe(1);
    expect(report.aggregate.byDomain.design.successRate).toBe(1);
  });

  it("computes per-tier stats correctly", () => {
    const results: ScenarioResult[] = [
      makeResult({ id: "s1", tier: "simple", success: true }),
      makeResult({ id: "s2", tier: "simple", success: true }),
      makeResult({ id: "s3", tier: "medium", success: false }),
      makeResult({ id: "s4", tier: "complex", success: true }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");

    expect(report.aggregate.byTier.simple.total).toBe(2);
    expect(report.aggregate.byTier.simple.successRate).toBe(1);
    expect(report.aggregate.byTier.medium.total).toBe(1);
    expect(report.aggregate.byTier.medium.successRate).toBe(0);
    expect(report.aggregate.byTier.complex.successRate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateReport — review flags integration
// ---------------------------------------------------------------------------
describe("generateReport — review flags", () => {
  it("calls applyReviewFlags with results and previous report", () => {
    const results = [makeResult({ id: "s1" })];
    const previousReport = {
      scenarios: [makeResult({ id: "old" })],
    } as EvalReport;

    generateReport(results, "claude-sonnet", "mock", 0, undefined, previousReport);

    expect(applyReviewFlags).toHaveBeenCalledWith(results, previousReport);
  });

  it("counts needsReview scenarios from results", () => {
    const results = [
      makeResult({ id: "s1", needsReview: true, reviewFlags: ["new-scenario"] }),
      makeResult({ id: "s2" }),
    ];
    // Mock applyReviewFlags to set needsReview on first result
    (applyReviewFlags as any).mockImplementation((res: ScenarioResult[]) => {
      res[0].needsReview = true;
      res[0].reviewFlags = ["new-scenario"];
      return 1;
    });

    const report = generateReport(results, "claude-sonnet", "mock");
    expect(report.aggregate.needsReview).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// generateReport — metadata
// ---------------------------------------------------------------------------
describe("generateReport — metadata", () => {
  it("includes model and tier in report", () => {
    const report = generateReport(
      [makeResult()],
      "claude-opus-4-20250514",
      "integration"
    );

    expect(report.model).toBe("claude-opus-4-20250514");
    expect(report.tier).toBe("integration");
  });

  it("uses provided runId when given", () => {
    const report = generateReport(
      [],
      "claude-sonnet",
      "mock",
      0,
      "custom-run-id"
    );

    expect(report.runId).toBe("custom-run-id");
  });

  it("generates runId when not provided", () => {
    const report = generateReport([], "claude-sonnet", "mock");
    expect(report.runId).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it("includes timestamp as ISO string", () => {
    const report = generateReport([], "claude-sonnet", "mock");
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes scenario results in report", () => {
    const results = [
      makeResult({ id: "s1" }),
      makeResult({ id: "s2" }),
    ];

    const report = generateReport(results, "claude-sonnet", "mock");
    expect(report.scenarios).toHaveLength(2);
    expect(report.scenarios[0].id).toBe("s1");
    expect(report.scenarios[1].id).toBe("s2");
  });
});

// ---------------------------------------------------------------------------
// loadPreviousReport — P13.8 (scenarios validation)
// ---------------------------------------------------------------------------
describe("loadPreviousReport", () => {
  it("returns null when results dir does not exist", () => {
    (fs.existsSync as any).mockReturnValue(false);
    expect(loadPreviousReport()).toBeNull();
  });

  it("returns null when results dir is empty", () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue([]);
    expect(loadPreviousReport()).toBeNull();
  });

  it("returns valid report when file has proper structure", () => {
    const report = {
      timestamp: "2026-02-27T00:00:00.000Z",
      aggregate: { total: 1 },
      scenarios: [{ id: "s1", success: true }],
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["2026-02-27-120000.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(report));
    expect(loadPreviousReport()).toEqual(report);
  });

  it("P13.8: returns null when report has no scenarios array", () => {
    const badReport = {
      timestamp: "2026-02-27T00:00:00.000Z",
      aggregate: { total: 0 },
      // scenarios is missing — would crash applyReviewFlags without P13.8
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["2026-02-27-120000.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(badReport));
    expect(loadPreviousReport()).toBeNull();
  });

  it("P13.8: returns null when scenarios is not an array", () => {
    const badReport = {
      timestamp: "2026-02-27T00:00:00.000Z",
      aggregate: { total: 0 },
      scenarios: "not-an-array",
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["2026-02-27-120000.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(badReport));
    expect(loadPreviousReport()).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["2026-02-27-120000.json"]);
    (fs.readFileSync as any).mockReturnValue("not json");
    expect(loadPreviousReport()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getGitSha — P14.2 (dirty-tree detection)
// ---------------------------------------------------------------------------
describe("getGitSha", () => {
  it("returns clean SHA when working tree is clean", () => {
    (childProcess.execSync as any)
      .mockReturnValueOnce("abc123def456\n")  // git rev-parse HEAD
      .mockReturnValueOnce("");                // git diff --quiet HEAD (success)

    expect(getGitSha()).toBe("abc123def456");
  });

  it("P14.2: appends -dirty when working tree has uncommitted changes", () => {
    (childProcess.execSync as any)
      .mockReturnValueOnce("abc123def456\n")   // git rev-parse HEAD
      .mockImplementationOnce(() => {           // git diff --quiet HEAD fails
        throw new Error("exit code 1");
      });

    expect(getGitSha()).toBe("abc123def456-dirty");
  });

  it("returns undefined when git is unavailable", () => {
    (childProcess.execSync as any).mockImplementation(() => {
      throw new Error("git not found");
    });

    expect(getGitSha()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findPassedScenarioIds — P14.3 (scenario content hashing)
// ---------------------------------------------------------------------------
describe("findPassedScenarioIds", () => {
  it("returns Map of passed scenario IDs with hashes", () => {
    const report = {
      gitSha: "abc123",
      scenarios: [
        { id: "s1", success: true, scenarioHash: "hash1" },
        { id: "s2", success: false },
        { id: "s3", success: true, scenarioHash: "hash3" },
      ],
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["report.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(report));

    const result = findPassedScenarioIds("abc123");

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("s1")).toBe("hash1");
    expect(result.has("s2")).toBe(false);
    expect(result.get("s3")).toBe("hash3");
  });

  it("returns undefined hash for pre-P14.3 reports", () => {
    const report = {
      gitSha: "abc123",
      scenarios: [
        { id: "s1", success: true },  // no scenarioHash field
      ],
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["report.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(report));

    const result = findPassedScenarioIds("abc123");

    expect(result.has("s1")).toBe(true);
    expect(result.get("s1")).toBeUndefined();
  });

  it("skips reports with non-matching git SHA", () => {
    const report = {
      gitSha: "other-sha",
      scenarios: [{ id: "s1", success: true }],
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["report.json"]);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(report));

    const result = findPassedScenarioIds("abc123");
    expect(result.size).toBe(0);
  });

  it("returns empty Map when no results dir", () => {
    (fs.existsSync as any).mockReturnValue(false);

    const result = findPassedScenarioIds("abc123");
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("skips malformed report files", () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(["bad.json"]);
    (fs.readFileSync as any).mockReturnValue("not json");

    const result = findPassedScenarioIds("abc123");
    expect(result.size).toBe(0);
  });
});
