/**
 * Human review flagging logic — auto-flags scenarios that need human attention.
 *
 * Why auto-flagging matters: with 55+ scenarios, reviewers can't inspect every
 * result manually. This module surfaces the scenarios most likely to benefit
 * from human judgment — disagreements between automated graders, low quality
 * scores, and new scenarios without established baselines.
 *
 * Flag criteria (from spec Tier 3):
 *   1. "judge-disagrees" — state check and LLM judge disagree:
 *      - State passes but judge scores <= 2 (may be a false positive)
 *      - State fails but judge scores >= 4 (may be a false negative)
 *   2. "low-quality" — LLM judge scores <= 2 regardless of state check
 *   3. "new-scenario" — scenario ID not present in the previous run
 */

import type { ScenarioResult, EvalReport } from "../harness/types.js";

/** Review flag reason identifiers */
export type ReviewFlag =
  | "judge-disagrees"
  | "low-quality"
  | "new-scenario";

/**
 * Compute review flags for a single scenario result.
 *
 * Returns an array of flag reason strings (empty if no flags).
 * A scenario is flagged for review if ANY flag is triggered.
 */
export function computeReviewFlags(
  result: ScenarioResult,
  previousScenarioIds?: Set<string>
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

  let flagged = 0;
  for (const result of results) {
    const flags = computeReviewFlags(result, previousIds);
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
