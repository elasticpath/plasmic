import {
  createAnthropicClient,
  createOpenAIClient,
} from "@/wab/server/copilot/llms";
import { executeUiCopilotChain } from "@/wab/server/copilot/ui-copilot-chain";
import { DbMgr } from "@/wab/server/db/DbMgr";
import { getUser, superDbMgr, userDbMgr } from "@/wab/server/routes/util";
import {
  CopilotInteractionId,
  PublicCopilotInteractionId,
  PublicQueryCopilotUiRequest,
  PublicQueryCopilotUiResponse,
  QueryCopilotFeedbackRequest,
  QueryCopilotRequest,
  QueryCopilotResponse,
  QueryCopilotUiRequest,
  QueryCopilotUiResponse,
  SendCopilotFeedbackRequest,
} from "@/wab/shared/ApiSchema";
import { mkShortId } from "@/wab/shared/common";
import { Request, Response } from "express";

// Handler for main copilot queries (chat, code, sql, debug)
export async function queryCopilot(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const user = getUser(req);
  const request = req.body as QueryCopilotRequest;

  try {
    // Check rate limit and track usage
    await mgr.useCopilotAndCheckRateLimit();

    let response: QueryCopilotResponse;

    // Route based on request type
    switch (request.type) {
      case "chat":
        response = await handleChatQuery(mgr, request, user);
        break;
      case "code":
        response = await handleCodeQuery(mgr, request, user);
        break;
      case "code-sql":
        response = await handleSqlQuery(mgr, request, user);
        break;
      case "debug":
        response = await handleDebugQuery(mgr, request, user);
        break;
      default:
        return res.status(400).json({ error: "Invalid request type" });
    }

    res.json(response);
  } catch (error: any) {
    if (error.name === "CopilotRateLimitExceededError") {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: error.message || "You have reached your copilot usage limit",
      });
    }
    console.error("Copilot error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Handler for UI copilot queries
export async function queryUiCopilot(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const user = getUser(req);
  const request = req.body as QueryCopilotUiRequest;

  try {
    // Check rate limit and track usage
    await mgr.useCopilotAndCheckRateLimit();

    // Generate UI based on request
    const copilotInteractionId = mkShortId() as CopilotInteractionId;
    const data = await handleUiQuery(mgr, request, user);

    // Store interaction
    await mgr.createCopilotInteraction({
      userPrompt: request.goal,
      response: JSON.stringify(data),
      model: request.useClaude ? "claude" : "gpt",
      projectId: request.projectId,
      request: { messages: [], model: "gpt-3.5-turbo" }, // TODO: Add proper request object
    });

    // TODO: Track usage

    const response: QueryCopilotUiResponse = {
      data,
      copilotInteractionId,
    };

    res.json(response);
  } catch (error: any) {
    if (error.name === "CopilotRateLimitExceededError") {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: error.message || "You have reached your copilot usage limit",
      });
    }
    console.error("UI Copilot error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Handler for public UI copilot queries
export async function queryPublicUiCopilot(req: Request, res: Response) {
  // Public endpoint doesn't require authentication, use SUPER_USER
  const mgr = superDbMgr(req);
  const request = req.body as PublicQueryCopilotUiRequest;

  try {
    // Simple rate limiting for public endpoint (by IP)
    // TODO: Implement proper rate limiting

    const id = mkShortId() as PublicCopilotInteractionId;
    const data = await handlePublicUiQuery(mgr, request);

    // Store public interaction
    await mgr.createPublicCopilotInteraction({
      userPrompt: request.goal,
      response: JSON.stringify(data),
      model: "gpt", // Default to GPT for public
      request: { messages: [], model: "gpt-3.5-turbo" }, // TODO: Add proper request object
    });

    const response: PublicQueryCopilotUiResponse = {
      data,
      id,
    };

    res.json(response);
  } catch (error) {
    console.error("Public UI Copilot error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Handler for copilot feedback submission
export async function sendCopilotFeedback(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const user = getUser(req);
  const request = req.body as SendCopilotFeedbackRequest;

  try {
    await mgr.saveCopilotFeedback({
      copilotInteractionId: request.id,
      projectId: request.projectId,
      feedback: request.feedback,
      feedbackDescription: request.feedbackDescription,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Feedback error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Handler for querying copilot feedback
export async function queryCopilotFeedback(req: Request, res: Response) {
  const mgr = userDbMgr(req);
  const user = getUser(req);
  const request = req.query as unknown as QueryCopilotFeedbackRequest;

  try {
    // Only admins can query feedback
    // TODO: Check if user is admin
    // if (!user.isAdmin) {
    //   return res.status(403).json({ error: "Forbidden" });
    // }

    const result = await mgr.queryCopilotFeedback({
      query: request.query || "",
      pageSize: request.pageSize,
      pageIndex: request.pageIndex,
    });

    res.json(result);
    return res.json(result);
  } catch (error) {
    console.error("Query feedback error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Helper functions for handling different query types
async function handleChatQuery(
  mgr: DbMgr,
  request: any,
  user: any
): Promise<QueryCopilotResponse> {
  // TODO: Implement chat query logic
  // TODO: Implement chat query logic
  const client = request.useClaude
    ? createAnthropicClient(mgr)
    : createOpenAIClient(mgr);

  // For now, return a placeholder response
  return {
    response: "Chat query handler not yet implemented",
  };
}

async function handleCodeQuery(
  mgr: DbMgr,
  request: any,
  user: any
): Promise<QueryCopilotResponse> {
  // TODO: Implement code generation logic
  return {
    response: "Code query handler not yet implemented",
  };
}

async function handleSqlQuery(
  mgr: DbMgr,
  request: any,
  user: any
): Promise<QueryCopilotResponse> {
  // TODO: Implement SQL generation logic
  return {
    response: "SQL query handler not yet implemented",
  };
}

async function handleDebugQuery(
  mgr: DbMgr,
  request: any,
  user: any
): Promise<QueryCopilotResponse> {
  // TODO: Implement debug query logic
  return {
    response: "Debug query handler not yet implemented",
  };
}

async function handleUiQuery(
  mgr: DbMgr,
  request: QueryCopilotUiRequest,
  user: any
): Promise<any> {
  // Execute the UI copilot chain to generate UI
  const result = await executeUiCopilotChain(
    {
      goal: request.goal,
      tokens: request.tokens,
      images: request.images,
      isPublicMode: false,
    },
    mgr
  );

  return result;
}

async function handlePublicUiQuery(
  mgr: DbMgr,
  request: PublicQueryCopilotUiRequest
): Promise<any> {
  return {
    actions: [
      {
        name: "insert-html",
        data: {
          html: "<div>Public UI generation not yet implemented</div>",
        },
      },
    ],
  };
  // // Execute the UI copilot chain for public requests
  // const result = await executeUiCopilotChain({
  //   goal: request.goal,
  //   tokens: undefined, // No tokens for public mode
  //   images: undefined, // No images for public mode
  //   isPublicMode: true,
  // }, mgr);

  // return result;
}
