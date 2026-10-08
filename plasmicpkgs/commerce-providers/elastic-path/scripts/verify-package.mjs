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
import { fileURLToPath, pathToFileURL } from "node:url";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
// The smoke loads the packed files from here, so only what the tarball ships
// can be imported; dependencies still resolve from the workspace install.
const installRoot = path.join(pkgDir, "node_modules/.verify-package");
const installedDir = path.join(installRoot, "node_modules", pkg.name);
const require = createRequire(path.join(installRoot, "index.cjs"));

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
const EXPECTED_SOURCE_MAPS = EXPECTED_DIST.filter((p) => /\.m?js$/.test(p)).map((p) => `${p}.map`);

const failures = [];
function check(label, ok, detail) {
  console.info(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) {
    failures.push(detail ? `${label}\n${detail}` : label);
  }
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
    (p) =>
      !EXPECTED_DIST.includes(p) &&
      !EXPECTED_SOURCE_MAPS.includes(p) &&
      !/^(package\.json|README|LICEN[CS]E|CHANGELOG)/i.test(p)
  );
  check("tarball carries only the built entry files", stray.length === 0, stray.join("\n"));
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
  if (ignoreRules.length) {
    args.push("--ignore-rules", ...ignoreRules);
  }
  const label = `arethetypeswrong ${entrypoint} ${
    ignoreRules.length ? `(ignoring ${ignoreRules.join(", ")})` : "(strict)"
  }`;
  try {
    execFileSync(path.join(pkgDir, "node_modules/.bin/attw"), args, {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: "pipe",
    });
    check(label, true);
  } catch (error) {
    check(label, false, `${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

// esbuild turns a require() in an ESM build into a __require() shim that
// throws wherever `require` is undefined: the canvas and hostless bundles in
// the browser, and native Node ESM.
function checkNoRequireShim() {
  for (const file of ["dist/index.esm.js", "dist/server.mjs"]) {
    if (!fs.existsSync(path.join(installedDir, file))) {
      continue;
    }
    const shimmed = [
      ...new Set(
        fs
          .readFileSync(path.join(installedDir, file), "utf8")
          .match(/__require\("[^"]+"\)/g) ?? []
      ),
    ];
    check(`${file} has no require() shim`, shimmed.length === 0, shimmed.join("\n"));
  }
}

// Browser code imports the root, so the root must not reach what only /server
// needs: better-auth, Next's server runtime and Node built-ins.
const SERVER_ONLY_MODULE =
  /^(?:better-auth(?:\/|$)|next\/server(?:\.js)?$|(?:node:)?(?:async_hooks|crypto)$)/;

function checkRootPullsInNoServerModule() {
  for (const file of ["dist/index.esm.js", "dist/index.js"]) {
    const { metafile } = esbuild.buildSync({
      entryPoints: [path.join(installedDir, file)],
      bundle: true,
      packages: "external",
      platform: "neutral",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const serverOnly = [
      ...new Set(
        Object.values(metafile.inputs)
          .flatMap((input) => input.imports)
          .filter((i) => i.external && SERVER_ONLY_MODULE.test(i.path))
          .map((i) => i.path)
      ),
    ];
    check(`${file} pulls in no /server module`, serverOnly.length === 0, serverOnly.join("\n"));
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

function install(tarball) {
  fs.rmSync(installRoot, { recursive: true, force: true });
  fs.mkdirSync(installedDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarball, "-C", installedDir, "--strip-components=1"]);
  // Its own package scope, or Node resolves the name to this package's dist.
  fs.writeFileSync(path.join(installRoot, "package.json"), `{ "private": true }\n`);
  fs.writeFileSync(path.join(installRoot, "server.mjs"), `export * from "${pkg.name}/server";\n`);
}

async function smokeServer() {
  const esm = await import(pathToFileURL(path.join(installRoot, "server.mjs")).href);
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

// The Studio canvas bundles the root ESM build and its dependencies as an
// IIFE, and supplies only React and @plasmicapp/host at run time, as CommonJS.
const CANVAS_EXTERNALS = ["@plasmicapp/host", "react", "react-dom"];

function loadRootAsCanvasBundle() {
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(installedDir, "dist/index.esm.js")],
    bundle: true,
    format: "iife",
    globalName: "__epRoot",
    platform: "browser",
    target: "es2020",
    external: CANVAS_EXTERNALS,
    write: false,
    logLevel: "silent",
  });
  const canvasRequire = (id) => {
    if (!CANVAS_EXTERNALS.some((e) => id === e || id.startsWith(`${e}/`))) {
      throw new Error(`the canvas cannot load "${id}" at run time`);
    }
    return require(id);
  };
  return new Function("require", `${outputFiles[0].text}\nreturn __epRoot;`)(canvasRequire);
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
try {
  checkFileSet(files);
  await checkPublint(tarball);
  checkAttw(tarball, ".", ROOT_ATTW_EXCEPTIONS);
  checkAttw(tarball, "./server", []);
  install(tarball);
  checkNoRequireShim();
  checkRootPullsInNoServerModule();
  for (const [label, smoke] of [["/server smoke", smokeServer], ["root smoke", smokeRoot]]) {
    try {
      await smoke();
    } catch (error) {
      check(label, false, error.stack);
    }
  }
} finally {
  fs.rmSync(path.dirname(tarball), { recursive: true, force: true });
  fs.rmSync(installRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
