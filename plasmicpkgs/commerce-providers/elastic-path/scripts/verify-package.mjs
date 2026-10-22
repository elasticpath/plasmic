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

const PUBLINT_EXCEPTIONS = [
  { code: "EXPORTS_TYPES_INVALID_FORMAT", path: ["exports", ".", "types"] },
  { code: "FILE_INVALID_FORMAT", path: ["exports", ".", "import"] },
  { code: "FILE_INVALID_FORMAT", path: ["exports", "./*"] },
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
  "dist/exports-map.json",
  "dist/exports/registerAll.js",
  "dist/esm/index.js",
];
const EXPECTED_SOURCE_MAPS = EXPECTED_DIST.filter((p) => /\.m?js$/.test(p)).map((p) => `${p}.map`);
const PER_MODULE_FILE = /^dist\/(?:esm\/.+\.js(?:\.map)?|exports\/[^/]+\.js)$/;

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
      !PER_MODULE_FILE.test(p) &&
      !/^(package\.json|README|LICEN[CS]E|CHANGELOG)/i.test(p)
  );
  check("tarball carries only the built entry files", stray.length === 0, stray.join("\n"));
  // A listed file that moves leaves its new path marked side-effect free.
  const gone = pkg.sideEffects
    .filter((p) => p.startsWith("./dist/"))
    .filter((p) => !paths.includes(p.slice(2)));
  check("every dist file in sideEffects is in the tarball", gone.length === 0, gone.join("\n"));
}

async function checkPublint(tarball) {
  const buffer = fs.readFileSync(tarball);
  const { messages, pkg: packedPkg } = await publint({
    pack: { tarball: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
    level: "warning",
  });
  const isRecorded = (m) =>
    PUBLINT_EXCEPTIONS.some(
      (e) => e.code === m.code && e.path.join("/") === m.path.join("/")
    );
  const unexpected = messages.filter((m) => !isRecorded(m));
  check(
    "publint reports only the recorded exceptions",
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
function requireShims(file) {
  return [
    ...new Set(
      fs
        .readFileSync(path.join(installedDir, file), "utf8")
        .match(/__require\("[^"]+"\)/g) ?? []
    ),
  ];
}

function checkNoRequireShim() {
  for (const file of ["dist/index.esm.js", "dist/server.mjs"]) {
    if (!fs.existsSync(path.join(installedDir, file))) {
      continue;
    }
    const shimmed = requireShims(file);
    check(`${file} has no require() shim`, shimmed.length === 0, shimmed.join("\n"));
  }
  const shimmed = perModuleFiles().flatMap((file) =>
    requireShims(file).map((shim) => `${file}: ${shim}`)
  );
  check("dist/esm has no require() shim", shimmed.length === 0, shimmed.join("\n"));
}

// A direct eval stops bundlers dropping any of a file's unused code.
function checkNoDirectEval() {
  const files = [
    "dist/index.esm.js",
    "dist/index.js",
    "dist/server.js",
    "dist/server.mjs",
    ...perModuleFiles(),
    ...perModuleFiles("dist/exports"),
  ];
  const withEval = files.filter((file) => /\beval\(/.test(fs.readFileSync(path.join(installedDir, file), "utf8")));
  check(`no built JavaScript file has a direct eval (${files.length} files)`, withEval.length === 0, withEval.join("\n"));
}

function checkRootNamesItsExports() {
  const main = fs.readFileSync(path.join(installedDir, "dist/index.esm.js"), "utf8");
  check("dist/index.esm.js names its exports, as Next.js needs of a client boundary", !/\bexport \*/.test(main));
}

function perModuleFiles(dir = "dist/esm") {
  return fs
    .readdirSync(path.join(installedDir, dir), { recursive: true })
    .map((p) => `${dir}/${p.split(path.sep).join("/")}`)
    .filter((p) => p.endsWith(".js"));
}

// Browser code imports the root, so the root must not reach what only /server
// needs: better-auth, Next's server runtime and Node built-ins.
const SERVER_ONLY_MODULE =
  /^(?:@?better-auth(?:\/|$)|next\/(?:server|headers)(?:\.js)?$|(?:node:)?(?:async_hooks|crypto)$)/;

function checkRootPullsInNoServerModule() {
  for (const file of ["dist/index.esm.js", "dist/index.js", "dist/esm/index.js"]) {
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
    const inside = await mod.withEpSession(session, async () => {
      const scoped = mod.getCurrentEpSession();
      scoped.cartId = "written-inside";
      return scoped;
    });
    check(`${format} withEpSession scopes getCurrentEpSession`, inside?.marker === format);
    check(
      `${format} withEpSession keeps writes inside the scope off the caller's session`,
      inside !== session && session.cartId === undefined && inside.cartId === "written-inside"
    );
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

function loadAsCanvasBundle(contents) {
  const { outputFiles } = esbuild.buildSync({
    stdin: { contents, resolveDir: installRoot, loader: "js" },
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
  const canvas = loadAsCanvasBundle(`export * from "${pkg.name}";`);
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

function perModuleImports(map, names) {
  const imports = names.map((name) => `import { ${name} } from "${pkg.name}/${map[name].slice(2)}";`);
  return `${imports.join("\n")}\nexport { ${names.join(", ")} };\n`;
}

const DEPENDENCIES = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].flatMap((name) => [name, `${name}/*`]);

const LOADER_EXTERNALS = ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@plasmicapp/*", "next", "next/*"];
const ROOT_OWN_CODE_LIMIT = 40_000;
const UNRELATED_TO_CART = /\/dist\/esm\/(?:catalog-search|account|checkout)\//;
const CHECKOUT_FILE_THE_CART_USES = "/dist/esm/checkout/session/shipping-line-sku.js";
const INSTANTSEARCH =
  /(?:^|\/)node_modules\/(?:instantsearch\.js|react-instantsearch(?:-[a-z]+)*|algoliasearch-helper|@elasticpath\/catalog-search-instantsearch-adapter)\//;

async function bundleAsLoader(name, contents) {
  const entry = path.join(installRoot, `${name}.js`);
  fs.writeFileSync(entry, contents);
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    splitting: true,
    treeShaking: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es6",
    external: LOADER_EXTERNALS,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    outdir: path.join(installRoot, `${name}-out`),
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const included = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0)
  );
  const search = [...new Set(included.map(([p]) => p).filter((p) => INSTANTSEARCH.test(p)))];
  const own = included.filter(([p]) => p.includes(`/${pkg.name}/dist/`));
  const bytes = result.outputFiles
    .filter((f) => f.path.endsWith(".js"))
    .reduce((sum, f) => sum + f.contents.length, 0);
  return {
    search,
    bytes,
    modules: own.map(([p]) => p),
    ownBytes: own.reduce((sum, [, input]) => sum + input.bytesInOutput, 0),
  };
}

function webpackModules(name, contents) {
  const entry = path.join(installRoot, `${name}.js`);
  fs.writeFileSync(entry, contents);
  const nextWebpack = require("next/dist/compiled/webpack/webpack");
  nextWebpack.init();
  return new Promise((resolve, reject) => {
    nextWebpack.webpack(
      {
        mode: "production",
        entry,
        output: { path: path.join(installRoot, `${name}-out`) },
        optimization: { concatenateModules: false, minimize: false },
        externals: [/^(?:react|react-dom|next)(?:\/.*)?$/, /^@plasmicapp\//],
        externalsType: "commonjs",
        performance: { hints: false },
      },
      (error, stats) => {
        if (error) {
          reject(error);
          return;
        }
        const info = stats.toJson({ modules: true, errors: true });
        if (info.errors.length) {
          reject(new Error(info.errors.map((e) => e.message).join("\n")));
          return;
        }
        resolve(info.modules.filter((m) => m.chunks?.length).map((m) => m.name));
      }
    );
  });
}

async function smokeModules() {
  const mapPath = require.resolve(`${pkg.name}/exports-map.json`);
  check(
    "exports-map.json resolves through exports",
    mapPath === path.join(installedDir, "dist/exports-map.json"),
    mapPath
  );
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const names = Object.keys(map);
  const cjs = require(pkg.name);
  sameNames("the exports map lists every root export", names, Object.keys(cjs));
  const misnamed = names.filter((name) => map[name] !== `./${name}`);
  check("every root export has the subpath of its own name", misnamed.length === 0, misnamed.join("\n"));

  let exported;
  try {
    const { metafile } = esbuild.buildSync({
      stdin: { contents: perModuleImports(map, names), resolveDir: installRoot, loader: "js" },
      bundle: true,
      format: "esm",
      platform: "neutral",
      external: DEPENDENCIES,
      outfile: path.join(installRoot, "all-modules.js"),
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    exported = Object.values(metafile.outputs)[0].exports;
  } catch (error) {
    check("every subpath in the exports map exports its name", false, error.message);
    return;
  }
  sameNames("every subpath in the exports map exports its name", exported, names);

  const fromCjs = captureRegistrations(cjs.registerAll);
  const modules = loadAsCanvasBundle(perModuleImports(map, ["registerAll"]));
  const fromModules = captureRegistrations(modules.registerAll);
  sameNames(
    "the per-module files register the same components as the CJS root",
    fromModules.components.map((m) => m.name),
    fromCjs.components.map((m) => m.name)
  );
  sameNames(
    "the per-module files register the same global contexts as the CJS root",
    fromModules.contexts.map((m) => m.name),
    fromCjs.contexts.map((m) => m.name)
  );

  const searchBox = await bundleAsLoader("search-box", perModuleImports(map, ["EPSearchBox"]));
  check("EPSearchBox pulls in InstantSearch, so the next check can see it", searchBox.search.length > 0);
  const productList = ["EPProductListProvider", "EPProductGrid"];
  const throughMap = await bundleAsLoader("product-list-modules", perModuleImports(map, productList));
  const throughRoot = await bundleAsLoader(
    "product-list-root",
    `export { ${productList.join(", ")} } from "${pkg.name}";\n`
  );
  check(
    `the product list through the map leaves out InstantSearch (${throughMap.bytes} bytes; ${throughRoot.bytes} through the root)`,
    throughMap.search.length === 0,
    throughMap.search.join("\n")
  );
  const fromRoot = await bundleAsLoader("cart-trigger-root", `export { EPCartDrawerTrigger } from "${pkg.name}";\n`);
  const unrelated = fromRoot.modules.filter(
    (m) => UNRELATED_TO_CART.test(m) && !m.endsWith(CHECKOUT_FILE_THE_CART_USES)
  );
  check(
    `EPCartDrawerTrigger from the root leaves out InstantSearch and the catalog-search, account and checkout modules, except the checkout constant the cart uses, with under ${ROOT_OWN_CODE_LIMIT} bytes of the package's code (${fromRoot.ownBytes}; ${fromRoot.bytes} in all)`,
    fromRoot.search.length === 0 && unrelated.length === 0 && fromRoot.ownBytes < ROOT_OWN_CODE_LIMIT,
    [...fromRoot.search, ...unrelated].join("\n")
  );

  const cartWrite = await webpackModules(
    "cart-write-webpack",
    `import { epAddCartItem } from "${pkg.name}";\nglobalThis.__epAddCartItem = epAddCartItem;\n`
  );
  check(
    "epAddCartItem from the root registers the cart cache under webpack, as the one-bundle root did",
    cartWrite.some((m) => m.endsWith("/cart-provider/swr-cart-cache.js"))
  );
}

const { tarball, files } = pack();
try {
  checkFileSet(files);
  await checkPublint(tarball);
  checkAttw(tarball, ".", ROOT_ATTW_EXCEPTIONS);
  checkAttw(tarball, "./server", []);
  install(tarball);
  checkNoRequireShim();
  checkNoDirectEval();
  checkRootNamesItsExports();
  checkRootPullsInNoServerModule();
  for (const [label, smoke] of [
    ["/server smoke", smokeServer],
    ["root smoke", smokeRoot],
    ["per-module smoke", smokeModules],
  ]) {
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
