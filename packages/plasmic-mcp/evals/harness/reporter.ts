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

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  ScenarioResult,
  EvalReport,
  DomainStats,
  TierStats,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESULTS_DIR = resolve(__dirname, "../results");

export function generateReport(
  results: ScenarioResult[],
  model: string,
  tier: "mock" | "integration",
  totalCostDollars: number = 0
): EvalReport {
  const now = new Date();
  const runId = formatRunId(now);

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter(
    (r) => !r.success && !r.errors.includes("Scenario timed out")
  ).length;
  const timedOut = results.filter((r) =>
    r.errors.includes("Scenario timed out")
  ).length;

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
    runId,
    timestamp: now.toISOString(),
    tier,
    model,
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
      byDomain,
      byTier,
    },
  };
}

/** Save report to evals/results/{runId}.json */
export function saveReport(report: EvalReport): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const filePath = resolve(RESULTS_DIR, `${report.runId}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2));
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
  console.error("");

  // Per-scenario table
  console.error(
    "  " +
      "Scenario".padEnd(35) +
      "Result".padEnd(10) +
      "Tools".padEnd(8) +
      "Duration".padEnd(12) +
      "Errors"
  );
  console.error("  " + "-".repeat(75));

  for (const s of report.scenarios) {
    const result = s.success ? "PASS" : "FAIL";
    const duration = `${(s.durationMs / 1000).toFixed(1)}s`;
    console.error(
      "  " +
        s.id.padEnd(35) +
        result.padEnd(10) +
        String(s.toolCalls).padEnd(8) +
        duration.padEnd(12) +
        (s.errors.length > 0 ? s.errors[0].substring(0, 30) : "")
    );
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
