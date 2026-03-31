import { StudioCtx } from "@/wab/client/studio-ctx/StudioCtx";
import { z } from "zod";

/**
 * Definition of a copilot tool (schema + metadata).
 * This is separate from the executor so it can be used on both
 * server (for tool definitions) and client (for execution).
 */
export interface CopilotToolDef<T extends z.ZodType = z.ZodType> {
  toolName: string;
  title: string;
  description: string;
  inputSchema: T;
}

/**
 * A copilot tool: definition + executor function.
 */
export interface CopilotTool<T extends z.ZodType = z.ZodType>
  extends CopilotToolDef<T> {
  execute: (studioCtx: StudioCtx, input: z.infer<T>) => Promise<string>;
}

/**
 * Factory to create a typed CopilotTool from a definition and executor.
 */
export function defineCopilotTool<T extends z.ZodType>(
  def: CopilotToolDef<T>,
  execute: (studioCtx: StudioCtx, input: z.infer<T>) => Promise<string>
): CopilotTool<T> {
  return { ...def, execute };
}

/**
 * Registry of all copilot tool definitions.
 * These are used for:
 * - Generating tool schemas for the AI model
 * - Type-safe tool call handling in useChat
 * - Displaying tool names/titles in the UI
 */
export const COPILOT_TOOL_DEFS = {
  read: {
    toolName: "read",
    title: "Read Project",
    description:
      "Read project data including components, elements, and tokens.",
    inputSchema: z.object({
      project: z.boolean().optional(),
      components: z.array(z.string()).optional(),
      elements: z.array(z.string()).optional(),
      tokens: z.array(z.string()).optional(),
    }),
  },
  insertHtml: {
    toolName: "insertHtml",
    title: "Insert HTML",
    description: "Insert HTML content into a component at a specific location.",
    inputSchema: z.object({
      html: z.string(),
      componentUuid: z.string(),
      tplUuid: z.string(),
      insertRelLoc: z.string().optional(),
      variantUuids: z.array(z.string()).optional(),
    }),
  },
} as const satisfies Record<string, CopilotToolDef>;
