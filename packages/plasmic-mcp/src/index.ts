/**
 * Entry point for the Plasmic MCP server.
 *
 * Starts a stdio-based MCP server using the STRAP architecture:
 * 8 domain tools (project, inspect, component, node, variant, design,
 * data, interaction) consolidating 99 actions total.
 *
 * Usage (development): tsx packages/plasmic-mcp/src/index.ts
 * Usage (production):  npx @elasticpath/plasmic-mcp
 *
 * CRITICAL: stdout is the JSON-RPC transport. All logging uses console.error().
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

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

main();
