/**
 * CLI argument parser for plasmic-mcp.
 *
 * Routes process.argv to the appropriate command:
 * - (no args)      → serve: start MCP server over stdio
 * - auth           → authenticate via browser init-token flow
 * - auth --host    → authenticate against a specific host
 * - --version      → print version and exit
 */

export interface ParsedArgs {
  command: "serve" | "auth" | "version";
  options: {
    host?: string;
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script, argv[2+] = user args
  const args = argv.slice(2);

  if (args.length === 0) {
    return { command: "serve", options: {} };
  }

  if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
    return { command: "version", options: {} };
  }

  if (args[0] === "auth") {
    const options: ParsedArgs["options"] = {};
    const hostIdx = args.indexOf("--host");
    if (hostIdx !== -1 && args[hostIdx + 1]) {
      options.host = args[hostIdx + 1];
    }
    return { command: "auth", options };
  }

  // Unknown command — default to serve
  return { command: "serve", options: {} };
}
