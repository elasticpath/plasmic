/**
 * Entry point for the Plasmic MCP server.
 *
 * Starts a stdio-based MCP server using the STRAP architecture:
 * 8 domain tools (project, inspect, component, node, variant, design,
 * data, interaction) consolidating 108 actions total.
 *
 * Usage (development): tsx packages/plasmic-mcp/src/index.ts
 * Usage (production):  npx @elasticpath/plasmic-mcp
 *
 * CRITICAL: stdout is the JSON-RPC transport. All logging uses console.error().
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { stopLiveSync } from "./live-sync.js";
import { stopPreviewServer } from "./preview-server.js";

// Prevent silent crashes from unhandled rejections (e.g. socket.io failures)
process.on("unhandledRejection", (reason) => {
  console.error("[plasmic-mcp] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[plasmic-mcp] Uncaught exception:", err);
});

// Graceful shutdown: disconnect socket so Studio removes the player avatar immediately.
// Claude Code closes stdin (not SIGTERM) when restarting the MCP server,
// so we also listen for stdin end and process beforeExit.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error("[plasmic-mcp] Shutting down...");
  stopLiveSync();
  stopPreviewServer().catch(() => {});
}
process.on("SIGTERM", () => { shutdown(); process.exit(0); });
process.on("SIGINT", () => { shutdown(); process.exit(0); });
process.on("beforeExit", shutdown);
process.stdin.on("close", shutdown);

async function main() {
  console.error("[plasmic-mcp] Starting Plasmic MCP server...");

  try {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[plasmic-mcp] Server connected via stdio");
  } catch (error) {
    console.error("[plasmic-mcp] Failed to start:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[plasmic-mcp] Unhandled startup error:", err);
  process.exit(1);
});
