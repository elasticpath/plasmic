/**
 * JSON report generator and console summary printer.
 *
 * After all scenarios run, produces a structured JSON report with per-scenario
 * results, aggregate metrics, and domain/tier breakdowns. Reports are saved
 * to evals/results/{runId}.json.
 *
 * Why JSON reports: they're machine-readable for CI checks and dashboard
 * rendering, while the console summary provides immediate human feedback.
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import type {
  ScenarioResult,
  EvalReport,
  DomainStats,
  TierStats,
  OverridesFile,
  ReviewOverride,
} from "./types.js";
import { applyReviewFlags } from "../graders/review-flags.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESULTS_DIR = resolve(__dirname, "../results");

/** Generate a runId string from the current timestamp: YYYY-MM-DD-HHmmss */
export function generateRunId(date: Date = new Date()): string {
  return formatRunId(date);
}

export function generateReport(
  results: ScenarioResult[],
  model: string,
  tier: "mock" | "integration",
  totalCostDollars: number = 0,
  runId?: string,
  previousReport?: EvalReport | null
): EvalReport {
  const now = new Date();
  const finalRunId = runId ?? formatRunId(now);

  // Apply review flags before building the report. This mutates each result
  // in place, setting needsReview and reviewFlags. The previous report is
  // used to detect new scenarios that lack established baselines.
  applyReviewFlags(results, previousReport);

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter(
    (r) => !r.success && !r.errors.includes("Scenario timed out")
  ).length;
  const timedOut = results.filter((r) =>
    r.errors.includes("Scenario timed out")
  ).length;
  const needsReviewCount = results.filter((r) => r.needsReview).length;

  // Per-domain success rates
  const byDomain: Record<string, DomainStats> = {};
  for (const r of results) {
    for (const domain of r.domains) {
      if (!byDomain[domain]) {
        byDomain[domain] = { total: 0, passed: 0, successRate: 0 };
      }
      byDomain[domain].total++;
      if (r.success) byDomain[domain].passed++;
    }
  }
  for (const stats of Object.values(byDomain)) {
    stats.successRate = stats.total > 0 ? stats.passed / stats.total : 0;
  }

  // Per-tier success rates
  const byTier: Record<string, TierStats> = {};
  for (const r of results) {
    if (!byTier[r.tier]) {
      byTier[r.tier] = { total: 0, passed: 0, successRate: 0 };
    }
    byTier[r.tier].total++;
    if (r.success) byTier[r.tier].passed++;
  }
  for (const stats of Object.values(byTier)) {
    stats.successRate = stats.total > 0 ? stats.passed / stats.total : 0;
  }

  const total = results.length;
  const qualityScores = results
    .map((r) => r.qualityScore)
    .filter((s): s is number => s !== null);

  return {
    runId: finalRunId,
    timestamp: now.toISOString(),
    tier,
    model,
    gitSha: getGitSha(),
    scenarios: results,
    aggregate: {
      total,
      passed,
      failed,
      timedOut,
      successRate: total > 0 ? passed / total : 0,
      meanToolCalls: mean(results.map((r) => r.toolCalls)),
      meanDurationMs: mean(results.map((r) => r.durationMs)),
      meanTokensInput: mean(results.map((r) => r.tokensInput)),
      meanTokensOutput: mean(results.map((r) => r.tokensOutput)),
      meanQualityScore:
        qualityScores.length > 0 ? mean(qualityScores) : null,
      totalCostDollars,
      needsReview: needsReviewCount,
      byDomain,
      byTier,
    },
  };
}

/** Save report to evals/results/{runId}.json.
 *  P12.2: Wraps writeFileSync in try/catch so disk-full or permission errors
 *  don't silently lose all results. Falls back to stderr JSON dump. */
export function saveReport(report: EvalReport): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const filePath = resolve(RESULTS_DIR, `${report.runId}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(report, null, 2));
  } catch (err: any) {
    // Filesystem write failed — dump the report to stderr so results
    // are not silently lost (can be piped to a file or captured by CI).
    process.stderr.write(
      `[eval] CRITICAL: Failed to save report to ${filePath}: ${err.message}\n`
    );
    process.stderr.write(JSON.stringify(report) + "\n");
    return filePath; // Return the intended path even though write failed
  }
  return filePath;
}

/** Print human-readable summary to stderr */
export function printSummary(report: EvalReport): void {
  const { aggregate } = report;

  console.error("\n" + "=".repeat(70));
  console.error("  EVAL RESULTS SUMMARY");
  console.error("=".repeat(70));
  console.error(`  Run ID:       ${report.runId}`);
  console.error(`  Model:        ${report.model}`);
  console.error(`  Tier:         ${report.tier}`);
  console.error(`  Total:        ${aggregate.total}`);
  console.error(`  Passed:       ${aggregate.passed}`);
  console.error(`  Failed:       ${aggregate.failed}`);
  console.error(`  Timed Out:    ${aggregate.timedOut}`);
  console.error(
    `  Success Rate: ${(aggregate.successRate * 100).toFixed(1)}%`
  );
  console.error(
    `  Est. Cost:   $${aggregate.totalCostDollars.toFixed(4)}`
  );
  if (aggregate.meanQualityScore !== null) {
    console.error(
      `  Mean Quality: ${aggregate.meanQualityScore.toFixed(1)}/5`
    );
  }
  if (aggregate.needsReview > 0) {
    console.error(
      `  Review Queue: ${aggregate.needsReview} scenario(s) flagged`
    );
  }
  console.error("");

  // Per-scenario table — include Quality column if any scenarios have scores
  const hasQuality = report.scenarios.some((s) => s.qualityScore !== null);

  if (hasQuality) {
    console.error(
      "  " +
        "Scenario".padEnd(35) +
        "Result".padEnd(10) +
        "Quality".padEnd(10) +
        "Tools".padEnd(8) +
        "Duration".padEnd(12) +
        "Errors"
    );
    console.error("  " + "-".repeat(85));
  } else {
    console.error(
      "  " +
        "Scenario".padEnd(35) +
        "Result".padEnd(10) +
        "Tools".padEnd(8) +
        "Duration".padEnd(12) +
        "Errors"
    );
    console.error("  " + "-".repeat(75));
  }

  for (const s of report.scenarios) {
    const result = s.success ? "PASS" : "FAIL";
    const reviewMark = s.needsReview ? " *" : "";
    const duration = `${(s.durationMs / 1000).toFixed(1)}s`;
    const quality = s.qualityScore !== null ? `${s.qualityScore}/5` : "-";

    if (hasQuality) {
      console.error(
        "  " +
          s.id.padEnd(35) +
          (result + reviewMark).padEnd(10) +
          quality.padEnd(10) +
          String(s.toolCalls).padEnd(8) +
          duration.padEnd(12) +
          (s.errors.length > 0 ? s.errors[0].substring(0, 30) : "")
      );
    } else {
      console.error(
        "  " +
          s.id.padEnd(35) +
          (result + reviewMark).padEnd(10) +
          String(s.toolCalls).padEnd(8) +
          duration.padEnd(12) +
          (s.errors.length > 0 ? s.errors[0].substring(0, 30) : "")
      );
    }
  }

  // Review queue — list flagged scenarios with their flag reasons
  const flaggedScenarios = report.scenarios.filter((s) => s.needsReview);
  if (flaggedScenarios.length > 0) {
    console.error("");
    console.error("  Review Queue (* = flagged):");
    for (const s of flaggedScenarios) {
      const flags = (s.reviewFlags ?? []).join(", ");
      console.error(`    ${s.id.padEnd(35)} [${flags}]`);
    }
  }

  // Domain breakdown
  if (Object.keys(aggregate.byDomain).length > 0) {
    console.error("");
    console.error("  By Domain:");
    for (const [domain, stats] of Object.entries(aggregate.byDomain)) {
      console.error(
        `    ${domain.padEnd(15)} ${stats.passed}/${stats.total} (${(stats.successRate * 100).toFixed(0)}%)`
      );
    }
  }

  console.error("=".repeat(70) + "\n");
}

/**
 * Load the most recent report from evals/results/ to use as the baseline
 * for new-scenario detection in review flags. Returns null if no previous
 * reports exist.
 */
export function loadPreviousReport(): EvalReport | null {
  if (!existsSync(RESULTS_DIR)) return null;

  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "overrides.json")
    .sort();

  if (files.length === 0) return null;

  // The last file alphabetically is the most recent (YYYY-MM-DD-HHmmss.json)
  const latestFile = files[files.length - 1];
  try {
    const content = readFileSync(join(RESULTS_DIR, latestFile), "utf-8");
    const report = JSON.parse(content) as EvalReport;
    if (report.timestamp && report.aggregate) {
      return report;
    }
  } catch {
    // Malformed file — skip
  }
  return null;
}

const OVERRIDES_PATH = resolve(RESULTS_DIR, "overrides.json");

/**
 * Load the overrides file from evals/results/overrides.json.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export function loadOverrides(): OverridesFile {
  if (!existsSync(OVERRIDES_PATH)) return {};
  try {
    const content = readFileSync(OVERRIDES_PATH, "utf-8");
    return JSON.parse(content) as OverridesFile;
  } catch {
    return {};
  }
}

/**
 * Save or update a single override annotation in overrides.json.
 * Merges with existing overrides — doesn't replace the entire file.
 */
export function saveOverride(
  scenarioId: string,
  override: ReviewOverride
): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = loadOverrides();
  existing[scenarioId] = {
    ...override,
    reviewedAt: override.reviewedAt ?? new Date().toISOString(),
  };
  writeFileSync(OVERRIDES_PATH, JSON.stringify(existing, null, 2));
}

/**
 * Get the current git commit SHA. Returns undefined if not in a git repo
 * or git is unavailable (e.g., CI container without git).
 */
export function getGitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Find scenario IDs that already passed in a previous run with the same git SHA.
 * Used for resume/skip: interrupted runs can be resumed without re-running
 * scenarios that already succeeded at this commit.
 */
export function findPassedScenarioIds(gitSha: string): Set<string> {
  const passed = new Set<string>();
  if (!existsSync(RESULTS_DIR)) return passed;

  const files = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && f !== "overrides.json"
  );

  for (const file of files) {
    try {
      const content = readFileSync(join(RESULTS_DIR, file), "utf-8");
      const report = JSON.parse(content) as EvalReport;
      if (report.gitSha === gitSha && report.scenarios) {
        for (const s of report.scenarios) {
          if (s.success) {
            passed.add(s.id);
          }
        }
      }
    } catch {
      // Skip malformed files
    }
  }

  return passed;
}

function formatRunId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
