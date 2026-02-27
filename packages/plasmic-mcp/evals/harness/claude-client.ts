/**
 * Claude conversation client for the eval harness.
 *
 * Wraps the Anthropic SDK to manage multi-turn tool-use conversations.
 * Each eval scenario becomes a conversation where:
 *   1. User sends the task prompt
 *   2. Claude responds with tool_use blocks
 *   3. Tool results are sent back
 *   4. Loop continues until Claude gives a final text response or timeout
 *
 * Why a custom wrapper instead of Promptfoo: our evals are multi-turn
 * tool-use conversations, not single-turn prompt-response pairs. This
 * wrapper handles the agentic loop, timeout, and transcript capture that
 * Promptfoo would need a custom provider for anyway.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicTool } from "./mcp-client.js";
import type { TranscriptEntry } from "./types.js";

interface Message {
  role: "user" | "assistant";
  content: any;
}

export interface ConversationResult {
  transcript: TranscriptEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCallCount: number;
  finalText: string;
  timedOut: boolean;
  /** Claude asked clarifying questions instead of calling tools (spec SE3) */
  incomplete: boolean;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = "claude-sonnet-4-20250514") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /**
   * Run a multi-turn conversation with Claude, routing tool calls through
   * the provided callback. Returns full transcript and usage metrics.
   */
  async runConversation(
    systemPrompt: string,
    userMessage: string,
    tools: AnthropicTool[],
    onToolCall: (
      name: string,
      input: Record<string, unknown>
    ) => Promise<{ content: string; isError: boolean }>,
    timeoutMs: number = 120_000
  ): Promise<ConversationResult> {
    const transcript: TranscriptEntry[] = [];
    const messages: Message[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolCallCount = 0;
    let finalText = "";
    let timedOut = false;
    let incomplete = false;

    const startTime = Date.now();

    // Initial user message
    messages.push({ role: "user", content: userMessage });
    transcript.push({
      role: "user",
      content: userMessage,
      timestamp: Date.now(),
    });

    // Conversation loop — max 25 turns prevents infinite loops
    const MAX_TURNS = 25;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Check timeout before each API call
      if (Date.now() - startTime > timeoutMs) {
        timedOut = true;
        break;
      }

      const remainingMs = timeoutMs - (Date.now() - startTime);

      let response: Anthropic.Message;
      try {
        response = await Promise.race([
          this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            tools: tools as any,
            messages,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("API call timeout")),
              remainingMs
            )
          ),
        ]);
      } catch (err: any) {
        if (err.message === "API call timeout") {
          timedOut = true;
          break;
        }
        throw err;
      }

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Record assistant response
      transcript.push({
        role: "assistant",
        content: JSON.stringify(response.content),
        timestamp: Date.now(),
        tokenUsage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      });

      // Add to conversation history
      messages.push({ role: "assistant", content: response.content });

      // end_turn = Claude is done (final text or clarifying question)
      if (response.stop_reason === "end_turn") {
        for (const block of response.content) {
          if (block.type === "text") {
            finalText += block.text;
          }
        }

        // Detect clarifying questions — if Claude never called tools and
        // responded with a question, mark as incomplete (spec SE3)
        if (toolCallCount === 0 && finalText.includes("?")) {
          incomplete = true;
        }
        break;
      }

      // tool_use = Claude wants to call tools
      if (response.stop_reason === "tool_use") {
        const toolResults: any[] = [];

        for (const block of response.content) {
          if (block.type === "tool_use") {
            toolCallCount++;

            // Execute the tool call via MCP client
            let result: { content: string; isError: boolean };
            try {
              result = await onToolCall(
                block.name,
                block.input as Record<string, unknown>
              );
            } catch (err: any) {
              // Tool errors don't stop the conversation — Claude may
              // self-correct on the next turn (spec EC1)
              result = { content: `Error: ${err.message}`, isError: true };
            }

            // Record tool result in transcript (truncated for readability)
            transcript.push({
              role: "tool_result",
              content: JSON.stringify({
                tool_use_id: block.id,
                name: block.name,
                input: block.input,
                result: result.content.substring(0, 500),
                isError: result.isError,
              }),
              timestamp: Date.now(),
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result.content,
              is_error: result.isError,
            });
          }
        }

        // Continue conversation with tool results
        messages.push({ role: "user", content: toolResults });
      }
    }

    return {
      transcript,
      totalInputTokens,
      totalOutputTokens,
      toolCallCount,
      finalText,
      timedOut,
      incomplete,
    };
  }
}
