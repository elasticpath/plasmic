/**
 * Entry point for the Plasmic MCP server.
 *
 * Starts a stdio-based MCP server that exposes 29 Plasmic Studio tools:
 *   Session: set-project, refresh-project
 *   Discovery: list-projects, get-project-meta, list-components
 *   Tree inspection: get-component-tree, get-component-summary, get-node-details,
 *     export-component-tree, get-subtree
 *   Tokens: get-tokens
 *   Creation: create-page, create-component, clone-component
 *   Editing: update-text, update-styles, add-child, remove-child, move-child
 *   Variants: list-variants
 *   Batch/undo/save: begin-batch, end-batch, undo, save-project
 *   Management: rename-component, update-page-meta, get-page-meta,
 *     get-preview-url, delete-component
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
