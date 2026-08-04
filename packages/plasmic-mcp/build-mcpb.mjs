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
 *
 * package.json is the single source of truth for the version. Claude Desktop
 * reads manifest.json, so a manifest version that drifts behind package.json
 * makes every build claim the same version and leaves no way to tell which
 * code a user has installed.
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

// Copy the manifest, taking the version from package.json.
const pkgVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
).version;
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "manifest.json"), "utf-8")
);

if (manifest.version !== pkgVersion) {
  // npm ships manifest.json too (see the `files` field), so the committed copy
  // must be corrected as well — the staged override only fixes the .mcpb.
  console.warn(
    `⚠ manifest.json version ${manifest.version} != package.json ${pkgVersion}; ` +
      `using ${pkgVersion}. Update manifest.json to match.`
  );
}
manifest.version = pkgVersion;

fs.writeFileSync(
  path.join(staging, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
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

console.log(`\n✓ Built ${output} (version ${pkgVersion})`);
