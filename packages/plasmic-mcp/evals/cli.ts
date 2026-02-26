/**
 * CLI entry point for the eval system.
 *
 * Usage:
 *   npm run eval                              Run all scenarios (mock tier)
 *   npm run eval -- --tier simple             Filter by complexity tier
 *   npm run eval -- --domain component        Filter by STRAP domain
 *   npm run eval -- --scenario design-list-tokens   Run single scenario
 *   npm run eval -- --integration             Use integration tier
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
import { runAll } from "./harness/runner.js";
import {
  generateReport,
  saveReport,
  printSummary,
} from "./harness/reporter.js";
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
  --no-visual                     Skip visual capture
  --max-cost <dollars>            Abort if projected cost exceeds $N (default: $5)
  --model <model-id>              Claude model to use (default: claude-sonnet-4-20250514)
  --threshold <0-1>               Success rate threshold (default: 0.9)
  --help, -h                      Show this help message`);
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

  const mcpClient = new McpEvalClient(mode as "mock" | "integration");
  const claudeClient = new ClaudeClient(apiKey, model);

  try {
    console.error(`[eval] Initializing MCP client (${mode} mode)...`);
    await mcpClient.initialize();
    console.error("[eval] MCP client ready");

    // Run scenarios
    const results = await runAll(
      scenarios,
      mcpClient,
      claudeClient,
      (completed, total, result) => {
        const status = result.success ? "PASS" : "FAIL";
        console.error(
          `[eval] [${completed}/${total}] ${result.id}: ${status} ` +
            `(${result.toolCalls} tools, ${(result.durationMs / 1000).toFixed(1)}s)`
        );
      },
      maxCost
    );

    // Generate and save report
    const report = generateReport(
      results,
      model,
      mode as "mock" | "integration"
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
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

main();
