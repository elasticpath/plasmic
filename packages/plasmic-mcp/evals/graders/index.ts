/**
 * Grader registry — dispatches grader configs to the appropriate implementation.
 *
 * Two categories of graders:
 *   - Transcript graders: validate tool call patterns from the conversation log
 *     (tool-sequence, tool-params, count, no-errors)
 *   - State graders: query the MCP server's current model state via tool calls
 *     (existence, property, structure, data)
 *
 * Why two categories: transcript graders are fast and don't require MCP calls,
 * while state graders validate the actual project state after Claude's changes.
 * Both work identically in mock and integration tiers since state graders
 * query via the same MCP protocol.
 */

import type {
  GraderConfig,
  GraderResult,
  TranscriptEntry,
} from "../harness/types.js";
import type { McpEvalClient } from "../harness/mcp-client.js";
import { runTranscriptGrader } from "./transcript-check.js";
import { runStateGrader } from "./state-check.js";

const TRANSCRIPT_GRADER_TYPES = new Set([
  "tool-sequence",
  "tool-params",
  "count",
  "no-errors",
]);

const STATE_GRADER_TYPES = new Set([
  "existence",
  "property",
  "structure",
  "data",
]);

export async function runGraders(
  graders: GraderConfig[],
  transcript: TranscriptEntry[],
  mcpClient: McpEvalClient
): Promise<GraderResult[]> {
  const results: GraderResult[] = [];

  for (const grader of graders) {
    try {
      let result: GraderResult;

      if (TRANSCRIPT_GRADER_TYPES.has(grader.type)) {
        result = runTranscriptGrader(grader, transcript);
      } else if (STATE_GRADER_TYPES.has(grader.type)) {
        result = await runStateGrader(grader, mcpClient);
      } else {
        result = {
          graderType: grader.type,
          passed: false,
          message: `Unknown grader type: "${grader.type}"`,
        };
      }

      results.push(result);
    } catch (err: any) {
      results.push({
        graderType: grader.type,
        passed: false,
        message: `Grader error: ${err.message}`,
      });
    }
  }

  return results;
}
