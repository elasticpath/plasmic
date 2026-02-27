/**
 * Human review flagging logic — auto-flags scenarios that need human attention.
 *
 * Why auto-flagging matters: with 55+ scenarios, reviewers can't inspect every
 * result manually. This module surfaces the scenarios most likely to benefit
 * from human judgment — disagreements between automated graders, low quality
 * scores, and new scenarios without established baselines.
 *
 * Flag criteria:
 *   1. "judge-disagrees" — state check and LLM judge disagree:
 *      - State passes but judge scores <= 2 (may be a false positive)
 *      - State fails but judge scores >= 4 (may be a false negative)
 *   2. "low-quality" — LLM judge scores <= 2 regardless of state check
 *   3. "new-scenario" — scenario ID not present in the previous run
 *   4. "regression" — scenario was passing in previous run but now fails (P14.6)
 *   5. "high-retries" — scenario passed but required >3 error-retry cycles (P14.7)
 */

import type { ScenarioResult, EvalReport } from "../harness/types.js";

/** Review flag reason identifiers */
export type ReviewFlag =
  | "judge-disagrees"
  | "low-quality"
  | "new-scenario"
  | "regression"
  | "high-retries";

/**
 * Compute review flags for a single scenario result.
 *
 * Returns an array of flag reason strings (empty if no flags).
 * A scenario is flagged for review if ANY flag is triggered.
 */
export function computeReviewFlags(
  result: ScenarioResult,
  previousScenarioIds?: Set<string>,
  previousScenarioSuccess?: Map<string, boolean>
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  // Flag 1: Judge disagrees with state check
  // This catches false positives (state says pass, judge says bad) and
  // false negatives (state says fail, judge says good).
  if (result.qualityScore !== null) {
    if (result.success && result.qualityScore <= 2) {
      flags.push("judge-disagrees");
    } else if (!result.success && result.qualityScore >= 4) {
      flags.push("judge-disagrees");
    }
  }

  // Flag 2: Low quality score (regardless of pass/fail)
  // P13.7: Always add low-quality when score <= 2, independently of judge-disagrees.
  // Before this fix, success=true + score=1 would get only judge-disagrees but never
  // low-quality, because the guard skipped low-quality when judge-disagrees was set
  // AND result.success was true. Both flags carry distinct signals: judge-disagrees
  // means the state check and judge conflict, while low-quality means the result
  // needs attention regardless of whether graders agree.
  if (result.qualityScore !== null && result.qualityScore <= 2) {
    flags.push("low-quality");
  }

  // Flag 3: New scenario — no baseline from previous run.
  // New scenarios need human review to validate the graders and rubrics
  // are calibrated correctly before trusting automated results.
  if (previousScenarioIds && !previousScenarioIds.has(result.id)) {
    flags.push("new-scenario");
  }

  // Flag 4: Regression — scenario was passing in previous run but now fails.
  // P14.6: Catching regressions early surfaces which changes broke previously-
  // working scenarios, preventing silent quality erosion across runs.
  if (previousScenarioSuccess && previousScenarioSuccess.has(result.id)) {
    const wasPassing = previousScenarioSuccess.get(result.id);
    if (wasPassing && !result.success) {
      flags.push("regression");
    }
  }

  // Flag 5: High retries — scenario passed but required many error-retry cycles.
  // P14.7: Fragile scenarios that pass by luck after multiple retries need human
  // attention even though they're technically passing. High retries suggest the
  // scenario definition or graders are miscalibrated.
  if (result.success && result.retries > 3) {
    flags.push("high-retries");
  }

  return flags;
}

/**
 * Apply review flags to all scenario results in a batch.
 *
 * Mutates each ScenarioResult in place, setting `needsReview` and
 * `reviewFlags`. Returns the count of flagged scenarios for summary output.
 */
export function applyReviewFlags(
  results: ScenarioResult[],
  previousReport?: EvalReport | null
): number {
  const previousIds = previousReport
    ? new Set(previousReport.scenarios.map((s) => s.id))
    : undefined;

  // P14.6: Build success map for regression detection — maps scenario ID
  // to whether it was passing in the previous run.
  const previousSuccess = previousReport
    ? new Map(previousReport.scenarios.map((s) => [s.id, s.success]))
    : undefined;

  let flagged = 0;
  for (const result of results) {
    const flags = computeReviewFlags(result, previousIds, previousSuccess);
    if (flags.length > 0) {
      result.needsReview = true;
      result.reviewFlags = flags;
      flagged++;
    } else {
      result.needsReview = false;
      result.reviewFlags = [];
    }
  }
  return flagged;
}
