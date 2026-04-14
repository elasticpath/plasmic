/**
 * Entry point for the Plasmic MCP server.
 *
 * Routes through the CLI parser:
 * - (no args) → start stdio MCP server
 * - auth      → browser init-token auth flow
 * - --version → print version and exit
 *
 * Usage (development): tsx packages/plasmic-mcp/src/index.ts
 * Usage (production):  npx @elasticpath/plasmic-mcp
 * Usage (auth):        npx @elasticpath/plasmic-mcp auth
 *
 * CRITICAL: stdout is the JSON-RPC transport in serve mode.
 * All logging uses console.error().
 */

// CRITICAL: Redirect console.log to stderr BEFORE any imports.
// Bundled WAB shared code contains console.log() calls that would write to
// stdout, corrupting the JSON-RPC transport. This must be the very first
// thing that executes.
console.log = console.error;

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { stopLiveSync } from "./live-sync.js";
import { stopPreviewServer } from "./preview-server.js";
import { parseArgs } from "./cli.js";
import { getAuth, writeAuth } from "./auth.js";
import { acquireAuth } from "./auth-flow.js";
import * as logger from "./logger.js";

const VERSION = "0.1.3";

const US_EAST_HOST = "https://useast.storefront.elasticpath.com";
const EU_WEST_HOST = "https://euwest.storefront.elasticpath.com";

const KNOWN_HOSTS: Record<string, string> = {
  useast: US_EAST_HOST,
  euwest: EU_WEST_HOST,
};

// Prevent silent crashes from unhandled rejections (e.g. socket.io failures)
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err?.stack ?? err}`);
});

// Graceful shutdown: disconnect socket so Studio removes the player avatar immediately.
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down...");
  stopLiveSync();
  stopPreviewServer().catch(() => {});
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

async function startServer() {
  logger.info("Starting Plasmic MCP server...");

  try {
    const server = createServer();
    logger.setMcpServer(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Server connected via stdio");
  } catch (error) {
    logger.error(`Failed to start: ${error}`);
    process.exit(1);
  }
}

async function runAuth(hostOption?: string) {
  // Resolve host: --host flag → existing auth host → prompt for selection
  let host = hostOption;

  if (!host) {
    const existingAuth = getAuth();
    if (existingAuth) {
      console.error(`[plasmic-mcp] Existing credentials found for ${existingAuth.host}`);
      host = existingAuth.host;
    }
  }

  if (!host) {
    // Default to US East — interactive host selection deferred to future iteration
    host = US_EAST_HOST;
    console.error(`[plasmic-mcp] Using default host: ${host}`);
  }

  // Resolve shorthand names
  if (KNOWN_HOSTS[host]) {
    host = KNOWN_HOSTS[host];
  }

  const config = await acquireAuth(host);
  writeAuth(config);
  console.error(`[plasmic-mcp] Authentication successful! Credentials saved for ${config.user}`);
}

async function main() {
  const { command, options } = parseArgs(process.argv);

  switch (command) {
    case "serve":
      await startServer();
      break;
    case "auth":
      await runAuth(options.host);
      break;
    case "version":
      // Version goes to stdout (not stderr) since this is a user-facing command, not stdio transport
      console.log(`@elasticpath/plasmic-mcp v${VERSION}`);
      process.exit(0);
      break;
  }
}

main().catch((err) => {
  console.error("[plasmic-mcp] Unhandled startup error:", err);
  process.exit(1);
});
