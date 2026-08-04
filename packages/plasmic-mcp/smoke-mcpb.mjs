/**
 * Smoke-test a packed .mcpb before it is published.
 *
 * Unpacks the bundle and drives the packed server over stdio the way Claude
 * Desktop does — bare `node server/index.cjs`, no TTY, nothing resolvable
 * outside the bundle. Asserts the handshake completes and every tool is
 * registered.
 *
 * This catches the failure that shipping an unverified bundle hides: the
 * bundle externalises its npm dependencies, so a staging install that missed
 * a package produces a server that dies on require, or starts but cannot
 * serve tools. Both look fine from `mcpb pack`.
 *
 * No credentials needed — the server starts unauthenticated and still
 * registers its full tool surface.
 *
 * Usage: node smoke-mcpb.mjs dist/visual-builder.mcpb [expectedToolCount]
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const mcpbPath = path.resolve(process.argv[2] ?? "dist/visual-builder.mcpb");
const expectedTools = Number(process.argv[3] ?? 10);

if (!fs.existsSync(mcpbPath)) {
  console.error(`✗ no bundle at ${mcpbPath}`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpb-smoke-"));
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
};

execSync(`unzip -q "${mcpbPath}" -d "${workDir}"`);

const manifest = JSON.parse(
  fs.readFileSync(path.join(workDir, "manifest.json"), "utf-8")
);
const entry = path.join(workDir, "server/index.cjs");
if (!fs.existsSync(entry)) fail("bundle has no server/index.cjs");

console.log(`smoke-testing ${manifest.name} v${manifest.version}`);

// Deliberately bare: cwd inside the bundle, so anything the server needs must
// be present in the bundle itself.
const child = spawn("node", [entry], {
  cwd: workDir,
  stdio: ["pipe", "pipe", "pipe"],
});

const stderr = [];
child.stderr.on("data", (d) => stderr.push(d.toString()));

let buf = "";
let settled = false;

const finish = (ok, msg) => {
  if (settled) return;
  settled = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  if (ok) {
    console.log(`✓ ${msg}`);
    fs.rmSync(workDir, { recursive: true, force: true });
    process.exit(0);
  }
  if (stderr.length) console.error(stderr.join("").trim().slice(-2000));
  fail(msg);
};

child.on("exit", (code, signal) => {
  if (!settled) finish(false, `server exited early (code=${code} signal=${signal})`);
});

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // stdout is the JSON-RPC transport; anything else on it corrupts the stream.
      return finish(false, `non-JSON on stdout: ${line.slice(0, 200)}`);
    }

    if (msg.id === 0) {
      if (msg.error) return finish(false, `initialize failed: ${JSON.stringify(msg.error)}`);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    }

    if (msg.id === 1) {
      if (msg.error) return finish(false, `tools/list failed: ${JSON.stringify(msg.error)}`);
      const tools = msg.result?.tools ?? [];
      if (tools.length < expectedTools) {
        return finish(
          false,
          `expected >=${expectedTools} tools, got ${tools.length}: ${tools.map((t) => t.name).join(",")}`
        );
      }
      return finish(true, `v${manifest.version}: handshake ok, ${tools.length} tools registered`);
    }
  }
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

send({
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "mcpb-smoke", version: "1.0.0" },
  },
});

setTimeout(() => finish(false, "timed out waiting for handshake"), 60000);
