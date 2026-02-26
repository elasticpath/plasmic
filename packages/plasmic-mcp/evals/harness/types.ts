/**
 * Core types for the Plasmic MCP eval system.
 *
 * These types define the scenario format (YAML → TypeScript), grading results,
 * execution transcripts, and the final report schema. Every eval component
 * (loader, runner, graders, reporter) imports from here.
 *
 * Why this file exists: a single source of truth for all eval data shapes,
 * ensuring the YAML scenarios, the runner, the graders, and the reporter
 * all agree on the same structures without runtime mismatches.
 */

// --- Scenario Schema ---

export interface EvalScenario {
  /** Unique identifier, e.g., "design-list-tokens" */
  id: string;
  /** Natural-language task prompt sent to Claude */
  description: string;
  /** Expected STRAP domains this scenario exercises */
  domains: string[];
  /** Complexity tier */
  tier: "simple" | "medium" | "complex";
  /** State checks to run after task completes */
  graders: GraderConfig[];
  /** Max seconds before timeout */
  timeout: number;
  /** Optional: tool calls to set up preconditions (run before Claude) */
  setup?: SetupStep[];
  /** Optional: LLM judge rubric (P2) */
  visual?: { rubric: string };
}

export interface GraderConfig {
  type:
    | "existence"
    | "property"
    | "structure"
    | "count"
    | "data"
    | "tool-sequence"
    | "tool-params"
    | "no-errors";
  params: Record<string, unknown>;
}

export interface SetupStep {
  /** Domain tool name (e.g., "project") */
  tool: string;
  /** Tool parameters */
  params: Record<string, unknown>;
}

// --- Transcript ---

export interface TranscriptEntry {
  role: "user" | "assistant" | "tool_result";
  content: string;
  timestamp: number;
  tokenUsage?: { input: number; output: number };
}

// --- Grader Results ---

export interface GraderResult {
  graderType: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// --- Visual Capture ---

export interface ScreenshotPaths {
  /** Absolute path to desktop viewport screenshot (1280x800) */
  desktop: string | null;
  /** Absolute path to mobile viewport screenshot (375x812), null if not a responsive scenario */
  mobile: string | null;
}

// --- Scenario Results ---

export interface ScenarioResult {
  id: string;
  tier: string;
  domains: string[];
  success: boolean;
  qualityScore: number | null;
  toolCalls: number;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
  errors: string[];
  retries: number;
  transcript: TranscriptEntry[];
  graderResults: GraderResult[];
  /** Screenshot paths from visual capture (integration tier only, null if skipped) */
  screenshotPaths?: ScreenshotPaths;
  /** Error message from visual capture, null on success or if skipped */
  visualError?: string;
  /** Brief rationale from LLM judge explaining the quality score */
  qualityRationale?: string;
  /** Model used for LLM judge scoring */
  judgeModel?: string;
  /** Input tokens consumed by the LLM judge call */
  judgeTokensInput?: number;
  /** Output tokens consumed by the LLM judge call */
  judgeTokensOutput?: number;
  /** Whether this scenario is flagged for human review */
  needsReview?: boolean;
  /** Reasons why this scenario was flagged for review */
  reviewFlags?: string[];
}

// --- Human Review Overrides ---

/**
 * A human reviewer's annotation for a specific scenario. Stored in
 * evals/results/overrides.json as a persistent companion file to the
 * JSON reports. Overrides let reviewers correct automated judgments
 * (e.g., mark a false-positive failure as actually passing).
 */
export interface ReviewOverride {
  /** Override the automated success determination */
  overrideSuccess?: boolean;
  /** Free-text notes from the reviewer */
  notes?: string;
  /** Who performed the review */
  reviewedBy?: string;
  /** ISO timestamp of the review */
  reviewedAt?: string;
}

/** Overrides file schema: scenario ID → override annotation */
export type OverridesFile = Record<string, ReviewOverride>;

// --- Report ---

export interface EvalReport {
  runId: string;
  timestamp: string;
  tier: "mock" | "integration";
  model: string;
  /** Git commit SHA at the time of the run, for resume/skip matching */
  gitSha?: string;
  scenarios: ScenarioResult[];
  aggregate: {
    total: number;
    passed: number;
    failed: number;
    timedOut: number;
    successRate: number;
    meanToolCalls: number;
    meanDurationMs: number;
    meanTokensInput: number;
    meanTokensOutput: number;
    meanQualityScore: number | null;
    totalCostDollars: number;
    /** Count of scenarios flagged for human review */
    needsReview: number;
    byDomain: Record<string, DomainStats>;
    byTier: Record<string, TierStats>;
  };
}

export interface DomainStats {
  total: number;
  passed: number;
  successRate: number;
}

export interface TierStats {
  total: number;
  passed: number;
  successRate: number;
}

// --- Eval Options ---

export interface EvalOptions {
  tier?: "simple" | "medium" | "complex";
  domain?: string;
  scenario?: string;
  integration?: boolean;
  noVisual?: boolean;
  maxCost?: number;
  model?: string;
  threshold?: number;
  /** Project ID for integration mode. Falls back to EVAL_PROJECT_ID env var, then auto-detect. */
  projectId?: string;
  /** Skip LLM judge quality scoring */
  noJudge?: boolean;
  /** Override model for LLM judge (ignores tier-based selection) */
  judgeModel?: string;
  /** Re-run all scenarios even if passing results exist for this git SHA */
  force?: boolean;
}
