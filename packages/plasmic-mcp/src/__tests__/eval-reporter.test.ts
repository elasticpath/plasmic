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
const { generateRunId, generateReport, saveReport, printSummary, loadPreviousReport, loadOverrides, saveOverride, getGitSha, findPassedScenarioIds } =
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

// ---------------------------------------------------------------------------
// saveReport — P12.2 (filesystem error fallback)
// ---------------------------------------------------------------------------
describe("saveReport", () => {
  it("writes report JSON to the expected file path", () => {
    const report = generateReport([makeResult()], "claude-sonnet", "mock", 0, "test-run-id");

    const filePath = saveReport(report);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("results"),
      { recursive: true }
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("test-run-id.json"),
      expect.any(String)
    );
    expect(filePath).toContain("test-run-id.json");
  });

  it("writes pretty-printed JSON (2-space indent)", () => {
    const report = generateReport([makeResult()], "claude-sonnet", "mock", 0, "run-1");

    saveReport(report);

    const writtenContent = (fs.writeFileSync as any).mock.calls[0][1];
    // Pretty-printed JSON starts with "{\n  " (2-space indent)
    expect(writtenContent).toContain("\n  ");
    const parsed = JSON.parse(writtenContent);
    expect(parsed.runId).toBe("run-1");
  });

  it("falls back to stderr on write failure", () => {
    (fs.writeFileSync as any).mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const report = generateReport([makeResult()], "claude-sonnet", "mock", 0, "fail-run");
    const filePath = saveReport(report);

    // Should still return the intended path
    expect(filePath).toContain("fail-run.json");
    // Should have written error message and JSON dump to stderr
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy.mock.calls[0][0]).toContain("CRITICAL");
    expect(stderrSpy.mock.calls[0][0]).toContain("ENOSPC");
    // Second call is the JSON dump of the full report
    const dumpedReport = JSON.parse((stderrSpy.mock.calls[1][0] as string).trim());
    expect(dumpedReport.runId).toBe("fail-run");

    stderrSpy.mockRestore();
  });

  it("creates results directory before writing", () => {
    const report = generateReport([], "claude-sonnet", "mock", 0, "dir-test");

    saveReport(report);

    // mkdirSync should be called before writeFileSync
    expect(fs.mkdirSync).toHaveBeenCalled();
    const mkdirCallOrder = (fs.mkdirSync as any).mock.invocationCallOrder[0];
    const writeCallOrder = (fs.writeFileSync as any).mock.invocationCallOrder[0];
    expect(mkdirCallOrder).toBeLessThan(writeCallOrder);
  });
});

// ---------------------------------------------------------------------------
// printSummary — console output format
// ---------------------------------------------------------------------------
describe("printSummary", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("prints header with run metadata", () => {
    const report = generateReport(
      [makeResult({ id: "s1" })],
      "claude-sonnet",
      "mock",
      0.5,
      "2026-02-28-120000"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("EVAL RESULTS SUMMARY");
    expect(output).toContain("2026-02-28-120000");
    expect(output).toContain("claude-sonnet");
    expect(output).toContain("mock");
  });

  it("prints pass/fail counts and success rate", () => {
    const report = generateReport(
      [
        makeResult({ id: "s1", success: true }),
        makeResult({ id: "s2", success: false, errors: ["error"] }),
      ],
      "claude-sonnet",
      "mock",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Passed:       1");
    expect(output).toContain("Failed:       1");
    expect(output).toContain("50.0%");
  });

  it("includes quality column when scenarios have quality scores", () => {
    const report = generateReport(
      [makeResult({ id: "s1", qualityScore: 4 })],
      "claude-sonnet",
      "integration",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Quality");
    expect(output).toContain("4/5");
  });

  it("omits quality column when no scores", () => {
    const report = generateReport(
      [makeResult({ id: "s1", qualityScore: null })],
      "claude-sonnet",
      "mock",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    // Column header "Quality" should not appear in the table header
    const tableHeaderLines = errorSpy.mock.calls
      .map((c) => c[0] as string)
      .filter((line) => line.includes("Scenario") && line.includes("Result"));
    expect(tableHeaderLines[0]).not.toContain("Quality");
  });

  it("shows review queue section when flagged scenarios exist", () => {
    const report = generateReport(
      [makeResult({ id: "flagged-scenario", needsReview: true, reviewFlags: ["new-scenario"] })],
      "claude-sonnet",
      "mock",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Review Queue");
    expect(output).toContain("flagged-scenario");
    expect(output).toContain("new-scenario");
  });

  it("shows domain breakdown", () => {
    const report = generateReport(
      [
        makeResult({ id: "s1", domains: ["component"], success: true }),
        makeResult({ id: "s2", domains: ["component"], success: false, errors: ["err"] }),
      ],
      "claude-sonnet",
      "mock",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("By Domain:");
    expect(output).toContain("component");
    expect(output).toContain("1/2");
  });

  it("truncates long error messages to 30 chars", () => {
    const report = generateReport(
      [makeResult({ id: "s1", success: false, errors: ["This is a very long error message that should be truncated to thirty characters"] })],
      "claude-sonnet",
      "mock",
      0,
      "run"
    );

    printSummary(report);

    const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    // The substring(0, 30) truncation: first 30 chars of the error
    expect(output).toContain("This is a very long error mess");
    expect(output).not.toContain("truncated to thirty characters");
  });
});

// ---------------------------------------------------------------------------
// loadOverrides
// ---------------------------------------------------------------------------
describe("loadOverrides", () => {
  it("returns empty object when file does not exist", () => {
    (fs.existsSync as any).mockReturnValue(false);
    expect(loadOverrides()).toEqual({});
  });

  it("returns parsed overrides when file exists", () => {
    const overrides = {
      "scenario-1": { verdict: "pass", notes: "Looks good", reviewedAt: "2026-02-28T00:00:00Z" },
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(overrides));

    expect(loadOverrides()).toEqual(overrides);
  });

  it("returns empty object on malformed JSON", () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue("not json at all");

    expect(loadOverrides()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// saveOverride
// ---------------------------------------------------------------------------
describe("saveOverride", () => {
  it("saves override with auto-generated reviewedAt", () => {
    (fs.existsSync as any).mockReturnValue(false);

    saveOverride("test-scenario", { verdict: "pass", notes: "ok" } as any);

    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse((fs.writeFileSync as any).mock.calls[0][1]);
    expect(written["test-scenario"]).toBeDefined();
    expect(written["test-scenario"].verdict).toBe("pass");
    expect(written["test-scenario"].reviewedAt).toBeDefined();
  });

  it("preserves existing overrides when adding new one", () => {
    const existing = {
      "existing-scenario": { verdict: "fail", notes: "bad", reviewedAt: "2026-01-01T00:00:00Z" },
    };
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify(existing));

    saveOverride("new-scenario", { verdict: "pass", notes: "good" } as any);

    const written = JSON.parse((fs.writeFileSync as any).mock.calls[0][1]);
    expect(written["existing-scenario"]).toBeDefined();
    expect(written["new-scenario"]).toBeDefined();
  });

  it("respects provided reviewedAt instead of auto-generating", () => {
    (fs.existsSync as any).mockReturnValue(false);

    saveOverride("test-scenario", {
      verdict: "pass",
      notes: "ok",
      reviewedAt: "2026-02-28T12:00:00Z",
    } as any);

    const written = JSON.parse((fs.writeFileSync as any).mock.calls[0][1]);
    expect(written["test-scenario"].reviewedAt).toBe("2026-02-28T12:00:00Z");
  });
});
