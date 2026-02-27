/**
 * LLM-as-Judge grader (Tier 2) — visual quality scoring via multimodal Claude.
 *
 * After each integration-tier scenario, the judge examines Studio screenshots
 * alongside the task prompt and tool call transcript, then assigns a 1-5
 * quality score with rationale.
 *
 * Why a separate judge from state checks: state graders validate that specific
 * properties exist (e.g., "heading has fontSize 48px"), but can't assess
 * overall visual quality — layout coherence, hierarchy, spacing, naming.
 * The LLM judge fills this qualitative gap, providing a holistic assessment
 * that complements the deterministic state checks.
 *
 * Scores are advisory only (not used for CI pass/fail) to avoid nondeterministic
 * test failures. They're tracked in the dashboard for trend analysis and flagged
 * for human review when they disagree with state check results.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "fs";
import type { TranscriptEntry, ScreenshotPaths } from "../harness/types.js";

export interface LlmJudgeResult {
  /** Quality score 1-5 */
  score: number;
  /** Brief explanation of the score */
  rationale: string;
  /** Model used for judging */
  model: string;
  /** API input tokens consumed */
  inputTokens: number;
  /** API output tokens consumed */
  outputTokens: number;
}

/**
 * Judge model selection by scenario tier.
 * Simple/Medium use Sonnet (fast, cost-effective).
 * Complex use Opus (highest quality visual assessment).
 */
const JUDGE_MODELS: Record<string, string> = {
  simple: "claude-sonnet-4-20250514",
  medium: "claude-sonnet-4-20250514",
  complex: "claude-opus-4-20250514",
};

const DEFAULT_RUBRIC =
  "Evaluate whether the task was completed successfully. Check that all " +
  "requested elements, styles, and configurations are visible in the " +
  "component tree, design surface, and property panels. Assess the overall " +
  "visual quality, layout coherence, and naming conventions.";

const JUDGE_SYSTEM_PROMPT = `You are a visual quality evaluator for Plasmic Studio, a visual web design tool. You assess how well an AI assistant completed a design task by examining screenshots of the Plasmic Studio editor view.

The editor view shows three panels:
- Left panel: component tree with element hierarchy and naming
- Center: design canvas showing the visual result
- Right panel: property inspector with styles and settings

Score the result on a 1-5 integer scale:
  5 = Exceeds expectations — visually well-structured, good hierarchy, appropriate spacing/sizing, clean naming in tree
  4 = Meets expectations — all visual requirements met, reasonable layout and structure
  3 = Acceptable — requirements met but with minor visual issues (poor spacing, inconsistent sizing, awkward nesting)
  2 = Partial — some requirements met, significant visual or structural issues
  1 = Failed — result does not visually match the intent despite tools being called

You MUST respond in exactly this format (nothing else):
SCORE: <number>
RATIONALE: <1-3 sentences>`;

/**
 * Run the LLM judge on a completed scenario's screenshots.
 * Returns null if the judge cannot run (no screenshots, API error, etc.).
 *
 * Per spec GE3: if the LLM judge API call fails, qualityScore = null,
 * log warning, continue. Judge failures never block the eval run.
 */
export async function runLlmJudge(options: {
  apiKey: string;
  scenarioTier: string;
  taskDescription: string;
  rubric?: string;
  transcript: TranscriptEntry[];
  screenshotPaths: ScreenshotPaths;
  /** Override model for all scenarios (ignores tier-based selection) */
  model?: string;
}): Promise<LlmJudgeResult | null> {
  const {
    apiKey,
    scenarioTier,
    taskDescription,
    rubric,
    transcript,
    screenshotPaths,
    model: modelOverride,
  } = options;

  // Build image content blocks from available screenshots
  const imageBlocks: Array<{
    type: "image";
    source: { type: "base64"; media_type: "image/png"; data: string };
  }> = [];

  // P13.5: Wrap readFileSync in try/catch — a race condition (file deleted between
  // existsSync and readFileSync) or permissions error would crash the judge.
  if (screenshotPaths.desktop && existsSync(screenshotPaths.desktop)) {
    try {
      const data = readFileSync(screenshotPaths.desktop).toString("base64");
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      });
    } catch {
      // File read failed — skip this screenshot
    }
  }

  if (screenshotPaths.mobile && existsSync(screenshotPaths.mobile)) {
    try {
      const data = readFileSync(screenshotPaths.mobile).toString("base64");
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      });
    } catch {
      // File read failed — skip this screenshot
    }
  }

  // Need at least one screenshot to judge
  if (imageBlocks.length === 0) {
    return null;
  }

  const model = modelOverride ?? JUDGE_MODELS[scenarioTier] ?? JUDGE_MODELS.medium;
  const client = new Anthropic({ apiKey });

  // Build the evaluation prompt
  const transcriptSummary = formatTranscriptForJudge(transcript);
  const effectiveRubric = rubric || DEFAULT_RUBRIC;
  const viewportNote =
    imageBlocks.length > 1
      ? "The first screenshot is the desktop viewport (1280x800). The second is the mobile viewport (375x812)."
      : "The screenshot shows the desktop viewport (1280x800).";

  const textPrompt =
    `${viewportNote}\n\n` +
    `## Task Description\n${taskDescription}\n\n` +
    `## Evaluation Rubric\n${effectiveRubric}\n\n` +
    `## Tool Calls Made\n${transcriptSummary}\n\n` +
    `Evaluate the screenshot(s) above and score the result.`;

  // Assemble multimodal message: images first, then text prompt
  const content: Array<
    | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }
    | { type: "text"; text: string }
  > = [...imageBlocks, { type: "text", text: textPrompt }];

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: content as any }],
    });

    // Extract text from response
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const parsed = parseJudgeResponse(text);
    if (!parsed) {
      console.error(`[judge] Failed to parse response: ${text.substring(0, 200)}`);
      return null;
    }

    return {
      score: parsed.score,
      rationale: parsed.rationale,
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err: any) {
    // GE3: LLM judge API error — return null, log warning, continue
    console.error(`[judge] API error: ${err.message}`);
    return null;
  }
}

/**
 * Parse the structured SCORE/RATIONALE response from the judge.
 * Returns null if the response doesn't match the expected format.
 *
 * P13.6: Uses \d+ to match multi-digit numbers. Without this,
 * "SCORE: 10" would be parsed as 1 instead of being rejected.
 */
export function parseJudgeResponse(
  text: string
): { score: number; rationale: string } | null {
  const scoreMatch = text.match(/SCORE:\s*(\d+)/);
  if (!scoreMatch) return null;

  const score = parseInt(scoreMatch[1], 10);
  if (score < 1 || score > 5) return null;

  const rationaleMatch = text.match(/RATIONALE:\s*([\s\S]+)/);
  const rationale = rationaleMatch
    ? rationaleMatch[1].trim()
    : "No rationale provided";

  return { score, rationale };
}

/**
 * Create a condensed transcript summary for the judge.
 * Only includes tool call names and brief results, keeping token usage low.
 * The judge needs to know what the AI did, not every JSON payload.
 */
export function formatTranscriptForJudge(transcript: TranscriptEntry[]): string {
  const lines: string[] = [];
  let callNum = 0;

  for (const entry of transcript) {
    if (entry.role === "tool_result") {
      callNum++;
      try {
        const parsed = JSON.parse(entry.content);
        const status = parsed.isError ? "ERROR" : "OK";
        const input = parsed.input ?? {};
        const action = input.action ? `.${input.action}` : "";
        const resultSnippet =
          typeof parsed.result === "string"
            ? parsed.result.substring(0, 100)
            : "";
        lines.push(
          `${callNum}. ${parsed.name}${action} → ${status}${resultSnippet ? ": " + resultSnippet : ""}`
        );
      } catch {
        lines.push(`${callNum}. (unparseable tool result)`);
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No tool calls recorded.";
}
