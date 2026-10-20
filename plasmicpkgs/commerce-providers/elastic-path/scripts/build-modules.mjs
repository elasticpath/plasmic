/**
 * Builds the per-module files a loader imports one component from: one ESM
 * file per source module the root entry reaches, under `dist/esm`, and
 * `dist/esm/exports-map.json`, from each root export to the file that defines
 * it. The root entry itself is `build:index`, unchanged. Run after it.
 *
 * Each source module stays its own file, never a pre-bundled subpath, so two
 * components on one page share one copy of each internal module and its state.
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(pkgDir, "src");
const outDir = path.join(pkgDir, "dist/esm");
const entry = path.join(srcDir, "index.tsx");
const mapFile = path.join(outDir, "exports-map.json");

const SOURCE_EXTENSION = /\.(tsx?|jsx?)$/;

/** The package subpath, under `exports["./esm/*.js"]`, of a source module's file. */
function subpathOf(sourceFile) {
  return `./esm/${path
    .relative(srcDir, sourceFile)
    .split(path.sep)
    .join("/")
    .replace(SOURCE_EXTENSION, ".js")}`;
}

function outFileOf(sourceFile) {
  return path.join(pkgDir, "dist", subpathOf(sourceFile));
}

function fail(lines) {
  throw new Error(`build-modules: ${lines.join("\n  ")}`);
}

/**
 * The source modules the root entry reaches, and the names it exports at run
 * time, as esbuild bundles it for `build:index`.
 */
async function rootGraph() {
  const { metafile, outputFiles } = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "neutral",
    outfile: path.join(pkgDir, "dist/root-graph.js"),
    absWorkingDir: pkgDir,
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  if (/^export \* from /m.test(outputFiles[0].text)) {
    fail([
      "the root re-exports a whole package, whose names the map cannot list",
    ]);
  }
  const modules = Object.keys(metafile.inputs).map((p) =>
    path.resolve(pkgDir, p)
  );
  const outside = modules.filter(
    (m) => !m.startsWith(srcDir + path.sep) || !SOURCE_EXTENSION.test(m)
  );
  if (outside.length) {
    fail(["the root reaches modules this build cannot emit:", ...outside]);
  }
  const [output] = Object.values(metafile.outputs);
  return { modules, rootExports: output.exports };
}

/**
 * Bundles each module on its own: every relative import stays an import, of
 * that module's file, and packages stay external as in `build:index`.
 */
async function buildModules(modules) {
  const graph = new Set(modules);
  const { metafile } = await esbuild.build({
    entryPoints: modules,
    bundle: true,
    packages: "external",
    format: "esm",
    target: "es6",
    platform: "neutral",
    outbase: srcDir,
    outdir: outDir,
    absWorkingDir: pkgDir,
    banner: { js: `"use client";` },
    sourcemap: true,
    metafile: true,
    logLevel: "warning",
    plugins: [
      {
        name: "keep-modules",
        setup(build) {
          build.onResolve({ filter: /^\./ }, async (args) => {
            if (args.kind === "entry-point" || args.pluginData?.keepModules) {
              return undefined;
            }
            const resolved = await build.resolve(args.path, {
              kind: args.kind,
              importer: args.importer,
              resolveDir: args.resolveDir,
              pluginData: { keepModules: true },
            });
            if (resolved.errors.length) {
              return { errors: resolved.errors };
            }
            if (!graph.has(resolved.path)) {
              return {
                errors: [
                  {
                    text: `${args.path} is not a module the root entry reaches`,
                  },
                ],
              };
            }
            let specifier = path
              .relative(
                path.dirname(outFileOf(args.importer)),
                outFileOf(resolved.path)
              )
              .split(path.sep)
              .join("/");
            if (!specifier.startsWith(".")) {
              specifier = `./${specifier}`;
            }
            return { path: specifier, external: true };
          });
        },
      },
    ],
  });
  const exportsByFile = new Map();
  for (const info of Object.values(metafile.outputs)) {
    if (info.entryPoint) {
      exportsByFile.set(
        path.resolve(pkgDir, info.entryPoint),
        new Set(info.exports)
      );
    }
  }
  return exportsByFile;
}

/**
 * Follows each root export, through re-exports, to the module that declares
 * it. The build fails on any name it cannot place, because a name that falls
 * back to the root loads a second copy of the package next to the per-module
 * files, with its own module state.
 */
function mapExports(rootExports, exportsByFile) {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(pkgDir, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) =>
        fail([ts.flattenDiagnosticMessageText(d.messageText, "\n")]),
    }
  );
  // Only symbols are read, so global type packages are not needed.
  const program = ts.createProgram({
    rootNames: [entry],
    options: { ...config.options, noEmit: true, types: [] },
  });
  const checker = program.getTypeChecker();
  const moduleExports = (fileName) =>
    checker.getExportsOfModule(
      checker.getSymbolAtLocation(program.getSourceFile(fileName))
    );
  const resolve = (symbol) =>
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  const rootSymbols = new Map(moduleExports(entry).map((s) => [s.name, s]));
  const map = {};
  const problems = [];
  for (const name of [...rootExports].sort()) {
    const symbol = rootSymbols.get(name);
    const target = symbol && resolve(symbol);
    const declaration = target?.valueDeclaration ?? target?.declarations?.[0];
    const file = declaration?.getSourceFile().fileName;
    if (!file || !exportsByFile.has(path.resolve(file))) {
      problems.push(
        `${name}: not declared in a source module (${file ?? "no declaration"})`
      );
      continue;
    }
    const own = moduleExports(file).find((s) => s.name === name);
    if (!own || resolve(own) !== target) {
      problems.push(
        `${name}: ${path.relative(pkgDir, file)} declares it under another name`
      );
      continue;
    }
    if (!exportsByFile.get(path.resolve(file)).has(name)) {
      problems.push(`${name}: ${subpathOf(file)} does not export it`);
      continue;
    }
    map[name] = subpathOf(file);
  }
  if (problems.length) {
    fail([
      "cannot map every root export to the file that defines it:",
      ...problems,
    ]);
  }
  return map;
}

const { modules, rootExports } = await rootGraph();
fs.rmSync(outDir, { recursive: true, force: true });
const exportsByFile = await buildModules(modules);
const map = mapExports(rootExports, exportsByFile);
fs.writeFileSync(mapFile, `${JSON.stringify(map, null, 2)}\n`);
console.info(
  `built ${modules.length} ESM modules at "dist/esm" and mapped ${
    Object.keys(map).length
  } root exports in "${path.relative(pkgDir, mapFile)}"`
);
