/**
 * CLI entry point for the eval system.
 *
 * Usage:
 *   npm run eval                              Run all scenarios (mock tier)
 *   npm run eval -- --tier simple             Filter by complexity tier
 *   npm run eval -- --domain component        Filter by STRAP domain
 *   npm run eval -- --scenario design-list-tokens   Run single scenario
 *   npm run eval -- --integration             Use integration tier
 *   npm run eval -- --project-id <id>         Project ID for integration tier
 *   npm run eval -- --max-cost 5              Cost limit in dollars (default: $5)
 *   npm run eval -- --model claude-opus-4-6   Override Claude model
 *   npm run eval -- --threshold 0.9           Success rate threshold (default: 90%)
 *
 * Exit codes:
 *   0 = success rate >= threshold
 *   1 = success rate < threshold or fatal error
 *
 * Why stderr for output: stdout is reserved for machine-readable output.
 * All human-readable progress, summaries, and errors go to stderr so the
 * JSON report can be piped if needed.
 */

import { loadScenarios } from "./harness/scenario-loader.js";
import { McpEvalClient } from "./harness/mcp-client.js";
import { ClaudeClient } from "./harness/claude-client.js";
import { runAll, type JudgeConfig } from "./harness/runner.js";
import {
  generateReport,
  generateRunId,
  saveReport,
  printSummary,
  loadPreviousReport,
} from "./harness/reporter.js";
import { VisualCapture } from "./visual/capture.js";
import { getAuthConfig } from "./visual/auth.js";
import type { EvalOptions } from "./harness/types.js";

function parseArgs(args: string[]): EvalOptions & { help?: boolean } {
  const options: EvalOptions & { help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--tier":
        options.tier = args[++i] as "simple" | "medium" | "complex";
        break;
      case "--domain":
        options.domain = args[++i];
        break;
      case "--scenario":
        options.scenario = args[++i];
        break;
      case "--integration":
        options.integration = true;
        break;
      case "--no-visual":
        options.noVisual = true;
        break;
      case "--max-cost":
        options.maxCost = parseFloat(args[++i]);
        break;
      case "--model":
        options.model = args[++i];
        break;
      case "--threshold":
        options.threshold = parseFloat(args[++i]);
        break;
      case "--project-id":
        options.projectId = args[++i];
        break;
      case "--no-judge":
        options.noJudge = true;
        break;
      case "--judge-model":
        options.judgeModel = args[++i];
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
    }
  }

  return options;
}

function printHelp(): void {
  console.error(`Usage: npm run eval [-- <options>]

Options:
  --tier <simple|medium|complex>  Filter scenarios by complexity tier
  --domain <name>                 Filter scenarios by STRAP domain
  --scenario <id>                 Run a single scenario by ID
  --integration                   Use integration tier (requires running Plasmic)
  --project-id <id>               Project ID for integration tier (or set EVAL_PROJECT_ID)
  --no-visual                     Skip visual capture (screenshots)
  --no-judge                      Skip LLM judge quality scoring
  --judge-model <model-id>        Override judge model (default: tier-based selection)
  --max-cost <dollars>            Abort if projected cost exceeds $N (default: $5)
  --model <model-id>              Claude model to use (default: claude-sonnet-4-20250514)
  --threshold <0-1>               Success rate threshold (default: 0.9)
  --help, -h                      Show this help message

Integration mode env vars:
  PLASMIC_AUTH_HOST                Plasmic API host (e.g., https://studio.plasmic.app)
  PLASMIC_AUTH_USER                Plasmic auth user/email
  PLASMIC_AUTH_TOKEN               Plasmic auth token
  EVAL_PROJECT_ID                  Target project ID (alternative to --project-id)

Visual capture env vars (integration mode, requires playwright):
  PLASMIC_STUDIO_EMAIL             Studio login email
  PLASMIC_STUDIO_PASSWORD          Studio login password`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Fail fast if API key is missing (spec EC4)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[eval] ERROR: ANTHROPIC_API_KEY environment variable is required."
    );
    console.error("[eval] Set it with: export ANTHROPIC_API_KEY=your-key-here");
    process.exit(1);
  }

  // Validate integration-mode env vars early so we fail fast before
  // loading scenarios or starting the MCP server.
  if (options.integration) {
    const requiredVars = [
      "PLASMIC_AUTH_HOST",
      "PLASMIC_AUTH_USER",
      "PLASMIC_AUTH_TOKEN",
    ];
    const missing = requiredVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      console.error(
        `[eval] ERROR: Integration mode requires: ${missing.join(", ")}`
      );
      console.error(
        "[eval] Set these environment variables before running integration evals."
      );
      process.exit(1);
    }
  }

  // Load scenarios
  const scenarios = loadScenarios(options);
  if (scenarios.length === 0) {
    console.error("[eval] No scenarios found matching filters.");
    process.exit(1);
  }
  console.error(`[eval] Loaded ${scenarios.length} scenario(s)`);

  // Initialize clients
  const mode = options.integration ? "integration" : "mock";
  const model = options.model ?? "claude-sonnet-4-20250514";
  const maxCost = options.maxCost ?? 5;
  const threshold = options.threshold ?? 0.9;
  const runId = generateRunId();

  const mcpClient = new McpEvalClient(mode, options.projectId);
  const claudeClient = new ClaudeClient(apiKey, model);

  // Visual capture — only in integration mode with --no-visual not set.
  // Mock mode has no real Studio to screenshot; the in-memory MCP server
  // operates entirely in-process without a visual frontend.
  let visualCapture: VisualCapture | undefined;
  if (mode === "integration" && !options.noVisual) {
    const authConfig = getAuthConfig();
    if (authConfig) {
      visualCapture = new VisualCapture({ runId, authConfig });
    } else {
      console.error(
        "[eval] Visual capture skipped: PLASMIC_STUDIO_EMAIL and " +
          "PLASMIC_STUDIO_PASSWORD are required for screenshots."
      );
    }
  }

  try {
    console.error(`[eval] Initializing MCP client (${mode} mode)...`);
    await mcpClient.initialize();
    console.error(
      `[eval] MCP client ready (project: ${mcpClient.getProjectId()})`
    );

    // LLM Judge config — only in integration mode with visual capture enabled.
    // The judge needs screenshots to assess visual quality. Mock mode has no
    // real Studio to screenshot, so the judge is always skipped there.
    let judgeConfig: JudgeConfig | undefined;
    if (mode === "integration" && !options.noVisual && !options.noJudge) {
      judgeConfig = {
        apiKey,
        model: options.judgeModel,
      };
    }

    // Initialize visual capture if configured
    if (visualCapture) {
      console.error("[eval] Initializing visual capture (Playwright)...");
      try {
        await visualCapture.initialize();
        console.error("[eval] Visual capture ready.");
      } catch (err: any) {
        console.error(
          `[eval] Visual capture init failed: ${err.message}. ` +
            "Continuing without screenshots."
        );
        visualCapture = undefined;
      }
    }

    // Disable judge if visual capture failed to initialize
    if (!visualCapture && judgeConfig) {
      console.error(
        "[eval] LLM judge disabled: visual capture not available."
      );
      judgeConfig = undefined;
    }

    // Run scenarios
    const { results, totalCostDollars } = await runAll(
      scenarios,
      mcpClient,
      claudeClient,
      (completed, total, result) => {
        const status = result.success ? "PASS" : "FAIL";
        const visual = result.screenshotPaths?.desktop ? " [screenshot]" : "";
        const judge = result.qualityScore !== null ? ` [quality: ${result.qualityScore}/5]` : "";
        console.error(
          `[eval] [${completed}/${total}] ${result.id}: ${status} ` +
            `(${result.toolCalls} tools, ${(result.durationMs / 1000).toFixed(1)}s)${visual}${judge}`
        );
      },
      maxCost,
      model,
      visualCapture,
      judgeConfig
    );

    // Load the previous report to detect new scenarios for review flagging.
    // This enables the "new-scenario" flag that surfaces scenarios without
    // established baselines for human review.
    const previousReport = loadPreviousReport();

    // Generate and save report (review flags are applied inside generateReport)
    const report = generateReport(
      results,
      model,
      mode as "mock" | "integration",
      totalCostDollars,
      runId,
      previousReport
    );
    const reportPath = saveReport(report);
    console.error(`[eval] Report saved: ${reportPath}`);

    // Print summary
    printSummary(report);

    // Exit code based on threshold
    if (report.aggregate.successRate < threshold) {
      console.error(
        `[eval] FAILED: Success rate ${(report.aggregate.successRate * 100).toFixed(1)}% ` +
          `< threshold ${(threshold * 100).toFixed(1)}%`
      );
      process.exit(1);
    }

    console.error(
      `[eval] PASSED: Success rate ${(report.aggregate.successRate * 100).toFixed(1)}%`
    );
    process.exit(0);
  } catch (err: any) {
    console.error(`[eval] Fatal error: ${err.message}`);
    console.error(err.stack);
    // Log server stderr if available (helps debug integration mode failures)
    const serverStderr = mcpClient.getServerStderr();
    if (serverStderr) {
      console.error("[eval] Server stderr:");
      console.error(serverStderr.substring(0, 2000));
    }
    process.exit(1);
  } finally {
    if (visualCapture) {
      await visualCapture.close();
    }
    await mcpClient.close();
  }
}

main();
