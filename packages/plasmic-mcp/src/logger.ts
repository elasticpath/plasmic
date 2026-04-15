/**
 * Logging for the MCP server.
 *
 * Three output channels:
 * 1. stderr (console.error) — captured by Claude Code and terminal stdio clients
 * 2. MCP logging notifications — captured by Claude Desktop and any MCP client
 * 3. File log — always available at ~/.plasmic-mcp.log for debugging
 *
 * stderr alone is NOT captured by Claude Desktop's built-in Node.js runner
 * for mcpb extensions. The MCP notification channel and file log ensure
 * observability regardless of how the server is launched.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_FILE = path.join(os.homedir(), ".plasmic-mcp.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB — rotate when exceeded

type LogLevel = "debug" | "info" | "warning" | "error";

/** MCP server reference — set after server is created. */
let mcpServer: { sendLoggingMessage: (params: { level: LogLevel; logger?: string; data: unknown }) => Promise<void> } | null = null;

export function setMcpServer(server: typeof mcpServer): void {
  mcpServer = server;
}

function timestamp(): string {
  return new Date().toISOString();
}

function rotateIfNeeded(): void {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      const backup = LOG_FILE + ".old";
      try { fs.unlinkSync(backup); } catch {}
      fs.renameSync(LOG_FILE, backup);
    }
  } catch {}
}

function writeToFile(level: LogLevel, message: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, `${timestamp()} [${level}] ${message}\n`);
  } catch {}
}

function sendToMcp(level: LogLevel, message: string): void {
  if (!mcpServer) return;
  mcpServer.sendLoggingMessage({ level, logger: "plasmic-mcp", data: message }).catch(() => {});
}

export function log(level: LogLevel, message: string): void {
  const formatted = `[plasmic-mcp] ${message}`;
  console.error(formatted);
  writeToFile(level, message);
  sendToMcp(level, message);
}

export function info(message: string): void { log("info", message); }
export function warn(message: string): void { log("warning", message); }
export function error(message: string): void { log("error", message); }
export function debug(message: string): void { log("debug", message); }
