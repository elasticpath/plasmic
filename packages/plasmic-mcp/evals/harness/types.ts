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
}

// --- Report ---

export interface EvalReport {
  runId: string;
  timestamp: string;
  tier: "mock" | "integration";
  model: string;
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
}
