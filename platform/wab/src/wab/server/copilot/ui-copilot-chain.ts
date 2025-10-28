import { createOpenAIClient } from "@/wab/server/copilot/llms";
import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  CopilotUiActions,
  CopilotUiActionsSchema,
  CopilotUiChainProps,
  CreateChatCompletionRequest,
  WholeChatCompletionResponse,
} from "@/wab/shared/copilot/prompt-utils";
import { zodToJsonSchema } from "zod-to-json-schema";

const SYSTEM_PROMPT = `You are an expert UI designer and developer assistant for Plasmic, a visual web builder. 
  Your task is to help users create UI components by generating clean, semantic HTML with inline styles.
  
  When users ask for complex layouts like "landing page", "website", or "homepage", generate a COMPLETE multi-section layout, not just a single section.
  
  Guidelines:
  - Generate modern, responsive, and accessible HTML fragments
  - Use semantic HTML5 elements (div, section, button, etc.) but NO document-level tags
  - Apply inline styles using style attributes
  - When design tokens are provided, use CSS variables like var(--token-primary) instead of hardcoded values
  - Ensure proper color contrast for accessibility
  - Use flexbox or grid for layouts when appropriate
  - Keep the HTML structure simple and maintainable
  - Include placeholder content that makes sense in context
  - Use rem/em units for better scalability
  - Add appropriate aria-labels for accessibility
  - NEVER include <html>, <body>, <head>, <meta>, <link>, or <script> tags
  
  IMPORTANT: You must respond with a JSON object with an "actions" array. Each action must have:
  - "name": must be exactly "insert-html" for HTML generation or "add-token" for design tokens
  - "data": for "insert-html", must have an "html" field with the HTML string
  
  Example response for HTML generation:
  {
    "actions": [
      {
        "name": "insert-html",
        "data": {
          "html": "<div>Your HTML here</div>"
        }
      }
    ]
  }`;

const UI_GENERATION_PROMPT = `Based on the user's request, generate appropriate UI elements.
  
  User request: {goal}
  
  {tokensContext}
  
  {imagesContext}
  
  Generate HTML that fulfills this request. The HTML should:
  1. Only include the inner content (no <html>, <head>, <body>, <meta>, or <script> tags)
  2. Use inline styles on each element
  3. Be responsive and modern
  4. Follow best practices for accessibility
  5. Be a self-contained component that can be inserted into an existing page
  
  For complex requests like "landing page" or "website", generate ALL necessary sections:
  - Hero section
  - Features/Services section
  - About section
  - Call-to-action section
  - Any other relevant sections
  
  IMPORTANT: 
  - Generate the COMPLETE component(s) requested, not just one part
  - For multi-section requests, include all sections in a single HTML response
  - Do NOT include document-level tags like html, body, head, etc.
  
  Respond with actions array containing either:
  - "insert-html" action with the generated HTML fragment
  - "add-token" action(s) if new design tokens should be created
  `;

function formatTokensContext(tokens?: CopilotUiChainProps["tokens"]): string {
  if (!tokens || tokens.length === 0) {
    return "";
  }

  return `Available design tokens:
  ${tokens
    .map(
      (t) =>
        `- ${t.name} (${t.type}): ${t.value} - Use as: var(--token-${t.name})`
    )
    .join("\n")}
  
  IMPORTANT: Reference these tokens in your styles using CSS variables:
  - For a token named "primary", use: var(--token-primary)
  - For a token named "spacing-lg", use: var(--token-spacing-lg)
  - Example: style="background-color: var(--token-primary); padding: var(--token-spacing-lg);"
  
  Always use the CSS variable format var(--token-NAME) instead of the raw value when a matching token exists.`;
}

function formatImagesContext(images?: CopilotUiChainProps["images"]): string {
  if (!images || images.length === 0) {
    return "";
  }

  return `The user has provided ${images.length} image(s) as reference. Consider these when designing the UI.`;
}

export async function executeUiCopilotChain(
  props: CopilotUiChainProps,
  mgr: DbMgr
): Promise<CopilotUiActions> {
  const { goal, tokens, images, isPublicMode } = props;

  console.log("Executing UI copilot chain with goal:", goal);

  // For public mode, use simpler prompts and models
  const model = isPublicMode ? "gpt-3.5-turbo" : "gpt-4";

  const prompt = UI_GENERATION_PROMPT.replace("{goal}", goal)
    .replace("{tokensContext}", formatTokensContext(tokens))
    .replace("{imagesContext}", formatImagesContext(images));

  const request: CreateChatCompletionRequest = {
    model,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 4000, // Increased for comprehensive landing pages
    tools: [
      {
        type: "function",
        function: {
          name: "generate_ui",
          description: "Generate UI elements based on user request",
          parameters: zodToJsonSchema(CopilotUiActionsSchema) as any,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "generate_ui" } },
  };

  try {
    const client = createOpenAIClient(mgr);
    const response: WholeChatCompletionResponse =
      await client.createChatCompletion(request);

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      throw new Error("No tool calls in response");
    }

    const toolCall = toolCalls[0];
    if (toolCall.type !== "function") {
      throw new Error("Unexpected tool call type");
    }

    const result = JSON.parse(toolCall.function.arguments || "{}");

    // Validate the response matches our schema
    const validated = CopilotUiActionsSchema.parse(result);

    return validated;
  } catch (error: any) {
    console.error("Error in UI copilot chain:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
    });

    // Fallback response with error message
    return {
      actions: [
        {
          name: "insert-html",
          data: {
            html: `<div style="padding: 20px; background-color: #f0f0f0; border-radius: 8px; text-align: center;">
                <p style="color: #666;">Unable to generate UI. Error: ${error.message}</p>
              </div>`,
          },
        },
      ],
    };
  }
}

// Example function to generate UI based on common patterns
export function generateExampleUI(type: string): string {
  const examples: Record<string, string> = {
    button: `<button style="background-color: #4CAF50; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500; transition: background-color 0.3s;">Click me</button>`,

    card: `<div style="background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 24px; max-width: 400px;">
        <h3 style="margin: 0 0 12px 0; color: #333; font-size: 24px;">Card Title</h3>
        <p style="margin: 0 0 16px 0; color: #666; line-height: 1.6;">This is a card component with some example content. You can customize it as needed.</p>
        <button style="background-color: #007bff; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer;">Learn more</button>
      </div>`,

    form: `<form style="max-width: 500px; padding: 24px;">
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #333; font-weight: 500;">Name</label>
          <input type="text" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;" placeholder="Enter your name">
        </div>
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; color: #333; font-weight: 500;">Email</label>
          <input type="email" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;" placeholder="Enter your email">
        </div>
        <button type="submit" style="background-color: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">Submit</button>
      </form>`,

    hero: `<section style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 80px 20px; text-align: center;">
        <h1 style="font-size: 48px; margin: 0 0 20px 0; font-weight: bold;">Welcome to Our Site</h1>
        <p style="font-size: 20px; margin: 0 0 32px 0; opacity: 0.9; max-width: 600px; margin-left: auto; margin-right: auto;">Discover amazing features and build something great today.</p>
        <div style="display: flex; gap: 16px; justify-content: center;">
          <button style="background-color: white; color: #667eea; padding: 12px 32px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500;">Get Started</button>
          <button style="background-color: transparent; color: white; padding: 12px 32px; border: 2px solid white; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: 500;">Learn More</button>
        </div>
      </section>`,
  };

  return examples[type] || examples.card;
}
