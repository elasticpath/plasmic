/**
 * Build .mcpb extension for Claude Desktop.
 *
 * Creates a self-contained staging directory with:
 * - manifest.json
 * - server/index.cjs (the esbuild bundle)
 * - node_modules/ (production dependencies only)
 * - package.json (for npm install --production)
 *
 * Then packs it into a .mcpb file using @anthropic-ai/mcpb.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staging = path.resolve(__dirname, "dist/mcpb-staging");

// Clean staging directory
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, "server"), { recursive: true });

// Copy manifest
fs.copyFileSync(
  path.resolve(__dirname, "manifest.json"),
  path.join(staging, "manifest.json")
);

// Copy built server bundle (without shebang — Claude Desktop runs it via node directly)
const bundle = fs.readFileSync(path.resolve(__dirname, "dist/index.cjs"), "utf-8");
const withoutShebang = bundle.replace(/^#!.*\n/, "");
fs.writeFileSync(path.join(staging, "server/index.cjs"), withoutShebang);

// Copy package.json for dependency installation
fs.copyFileSync(
  path.resolve(__dirname, "package.json"),
  path.join(staging, "package.json")
);

// Install production dependencies into staging
console.log("Installing production dependencies...");
execSync("npm install --omit=dev --ignore-scripts --no-optional --legacy-peer-deps", {
  cwd: staging,
  stdio: "pipe",
});

// Remove devDependencies artifacts and unnecessary files to reduce size
const nmPath = path.join(staging, "node_modules");
const cleanPatterns = [
  "**/.github",
  "**/test",
  "**/tests",
  "**/__tests__",
  "**/docs",
  "**/example",
  "**/examples",
  "**/*.map",
  "**/*.ts.map",
  "**/CHANGELOG.md",
  "**/HISTORY.md",
];

// Remove package.json from staging (not needed in final bundle)
fs.unlinkSync(path.join(staging, "package.json"));
// Remove package-lock.json if created
try { fs.unlinkSync(path.join(staging, "package-lock.json")); } catch {}

// Pack into .mcpb
const output = path.resolve(__dirname, "dist/visual-builder.mcpb");
console.log("Packing .mcpb...");
execSync(`npx @anthropic-ai/mcpb pack "${staging}" "${output}"`, {
  cwd: __dirname,
  stdio: "inherit",
});

// Clean staging
fs.rmSync(staging, { recursive: true, force: true });

console.log(`\n✓ Built ${output}`);
