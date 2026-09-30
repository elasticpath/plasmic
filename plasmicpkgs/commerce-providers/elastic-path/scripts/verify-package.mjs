/**
 * The packaging seam, run against the built output and the packed tarball:
 * publint, arethetypeswrong once per entry point, and a smoke that loads each
 * bundle the way its consumer does. Run `pnpm build` first.
 *
 * The root entry's recorded exceptions are ADR-0007 (docs/adr).
 */
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const require = createRequire(path.join(pkgDir, "package.json"));

const ROOT_PUBLINT_EXCEPTIONS = [
  { code: "EXPORTS_TYPES_INVALID_FORMAT", path: ["exports", ".", "types"] },
  { code: "FILE_INVALID_FORMAT", path: ["exports", ".", "import"] },
];
const ROOT_ATTW_EXCEPTIONS = ["unexpected-module-syntax"];

const EXPECTED_DIST = [
  "dist/index.d.ts",
  "dist/index.esm.js",
  "dist/index.js",
  "dist/server.d.mts",
  "dist/server.d.ts",
  "dist/server.js",
  "dist/server.mjs",
];

const failures = [];
function check(label, ok, detail) {
  console.info(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(detail ? `${label}\n${detail}` : label);
}

function pack() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "ep-verify-package-"));
  const [result] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", dest],
      { cwd: pkgDir, encoding: "utf8" }
    )
  );
  return { tarball: path.join(dest, result.filename), files: result.files };
}

function checkFileSet(files) {
  const paths = files.map((f) => f.path);
  const missing = EXPECTED_DIST.filter((p) => !paths.includes(p));
  check("tarball carries every built entry file", missing.length === 0, missing.join("\n"));
  const stray = paths.filter(
    (p) => !p.startsWith("dist/") && !/^(package\.json|README|LICEN[CS]E|CHANGELOG)/i.test(p)
  );
  check("tarball carries nothing outside dist/", stray.length === 0, stray.join("\n"));
}

async function checkPublint(tarball) {
  const buffer = fs.readFileSync(tarball);
  const { messages, pkg: packedPkg } = await publint({
    pack: { tarball: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
    level: "warning",
  });
  const isRecorded = (m) =>
    ROOT_PUBLINT_EXCEPTIONS.some(
      (e) => e.code === m.code && e.path.join("/") === m.path.join("/")
    );
  const unexpected = messages.filter((m) => !isRecorded(m));
  check(
    "publint reports only the recorded root exceptions",
    unexpected.length === 0,
    unexpected.map((m) => `${m.type}: ${formatMessage(m, packedPkg)}`).join("\n")
  );
}

function checkAttw(tarball, entrypoint, ignoreRules) {
  const args = [tarball, "--entrypoints", entrypoint, "--format", "table-flipped"];
  if (ignoreRules.length) args.push("--ignore-rules", ...ignoreRules);
  try {
    execFileSync(path.join(pkgDir, "node_modules/.bin/attw"), args, {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: "pipe",
    });
    check(`arethetypeswrong ${entrypoint}${ignoreRules.length ? ` (ignoring ${ignoreRules.join(", ")})` : " (strict)"}`, true);
  } catch (error) {
    check(`arethetypeswrong ${entrypoint}`, false, `${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

// esbuild turns a require() in an ESM build into a __require() shim that
// throws wherever `require` is undefined: the canvas and hostless bundles in
// the browser, and native Node ESM.
function checkNoRequireShim() {
  for (const file of ["dist/index.esm.js", "dist/server.mjs"]) {
    const shimmed = [
      ...new Set(
        fs
          .readFileSync(path.join(pkgDir, file), "utf8")
          .match(/__require\("[^"]+"\)/g) ?? []
      ),
    ];
    check(`${file} has no require() shim`, shimmed.length === 0, shimmed.join("\n"));
  }
}

function sameNames(label, actual, expected) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  const missing = e.filter((n) => !a.includes(n));
  const extra = a.filter((n) => !e.includes(n));
  check(
    label,
    missing.length === 0 && extra.length === 0 && a.length > 0,
    `missing: ${missing.join(", ") || "-"}\nextra: ${extra.join(", ") || "-"}`
  );
}

async function smokeServer() {
  const esm = await import(`${pkg.name}/server`);
  const cjs = require(`${pkg.name}/server`);
  sameNames("require(/server) exposes the same names as import(/server)", Object.keys(cjs), Object.keys(esm));

  for (const [format, mod] of [["ESM", esm], ["CJS", cjs]]) {
    const session = { marker: format };
    const inside = await mod.withEpSession(session, async () => mod.getCurrentEpSession());
    check(`${format} withEpSession scopes getCurrentEpSession`, inside === session);
    check(`${format} getCurrentEpSession is empty outside the scope`, mod.getCurrentEpSession() === undefined);
    const fallback = await mod.seedCartFallback();
    check(
      `${format} seedCartFallback seeds an empty cart outside a session`,
      Object.values(fallback).length === 1 && Object.values(fallback)[0] === null
    );
  }
}

function captureRegistrations(registerAll) {
  globalThis.__PlasmicComponentRegistry = [];
  globalThis.__PlasmicContextRegistry = [];
  registerAll();
  return {
    components: globalThis.__PlasmicComponentRegistry.map((r) => r.meta),
    contexts: globalThis.__PlasmicContextRegistry.map((r) => r.meta),
  };
}

// The Studio canvas bundles the root ESM build as an IIFE and supplies
// @plasmicapp/host as CommonJS at run time.
function loadRootAsCanvasBundle() {
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(pkgDir, "dist/index.esm.js")],
    bundle: true,
    format: "iife",
    globalName: "__epRoot",
    platform: "browser",
    target: "es2020",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  return new Function("require", `${outputFiles[0].text}\nreturn __epRoot;`)(require);
}

function smokeRoot() {
  const cjs = require(pkg.name);
  const canvas = loadRootAsCanvasBundle();
  sameNames("require(root) exposes the same names as the root ESM build", Object.keys(cjs), Object.keys(canvas));

  const fromCjs = captureRegistrations(cjs.registerAll);
  let fromCanvas;
  try {
    fromCanvas = captureRegistrations(canvas.registerAll);
  } catch (error) {
    check("canvas bundle registerAll runs", false, error.stack);
    return;
  }
  check("canvas bundle registerAll runs", true);
  check(
    `registers components (${fromCanvas.components.length}) and global contexts (${fromCanvas.contexts.length})`,
    fromCanvas.components.length > 0 && fromCanvas.contexts.length > 0
  );
  sameNames(
    "canvas bundle registers the same components as the CJS root",
    fromCanvas.components.map((m) => m.name),
    fromCjs.components.map((m) => m.name)
  );
  sameNames(
    "canvas bundle registers the same global contexts as the CJS root",
    fromCanvas.contexts.map((m) => m.name),
    fromCjs.contexts.map((m) => m.name)
  );
  const unreachable = [...fromCjs.components, ...fromCjs.contexts]
    .filter((m) => !m.importName || !(m.importName in cjs))
    .map((m) => `${m.name} -> ${m.importName ?? "(no importName)"}`);
  check("every registered importName is exported from the root", unreachable.length === 0, unreachable.join("\n"));
}

const { tarball, files } = pack();
checkFileSet(files);
await checkPublint(tarball);
checkAttw(tarball, ".", ROOT_ATTW_EXCEPTIONS);
checkAttw(tarball, "./server", []);
checkNoRequireShim();
for (const [label, smoke] of [["/server smoke", smokeServer], ["root smoke", smokeRoot]]) {
  try {
    await smoke();
  } catch (error) {
    check(label, false, error.stack);
  }
}
fs.rmSync(path.dirname(tarball), { recursive: true, force: true });

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
