import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(pkgDir, "src");
const distDir = path.join(pkgDir, "dist");
const modulesDir = path.join(distDir, "esm");
const namesDir = path.join(distDir, "exports");
const mapFile = path.join(distDir, "exports-map.json");
const entry = path.join(srcDir, "index.tsx");

const SOURCE_EXTENSION = /\.(tsx?|jsx?)$/;

function builtPathOf(sourceFile) {
  return `esm/${path
    .relative(srcDir, sourceFile)
    .split(path.sep)
    .join("/")
    .replace(SOURCE_EXTENSION, ".js")}`;
}

function outFileOf(sourceFile) {
  return path.join(distDir, builtPathOf(sourceFile));
}

function fail(lines) {
  throw new Error(`build-modules: ${lines.join("\n  ")}`);
}

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
    outdir: modulesDir,
    absWorkingDir: pkgDir,
    banner: { js: `"use client";` },
    sourcemap: true,
    metafile: true,
    logLevel: "warning",
    plugins: [
      // Each module stays its own file, never pre-bundled, or two components
      // on one page get two copies of its state.
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

function findDefiningModules(rootExports, exportsByFile) {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(pkgDir, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) =>
        fail([ts.flattenDiagnosticMessageText(d.messageText, "\n")]),
    }
  );
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
  const definedIn = {};
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
      problems.push(`${name}: ${builtPathOf(file)} does not export it`);
      continue;
    }
    definedIn[name] = file;
  }
  // A name left on the root would load a second copy of the package.
  if (problems.length) {
    fail([
      "cannot map every root export to the file that defines it:",
      ...problems,
    ]);
  }
  return definedIn;
}

function writeNamedEntries(definedIn) {
  const { exports } = JSON.parse(
    fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")
  );
  const taken = new Set(
    Object.keys(exports)
      .filter((subpath) => !subpath.includes("*"))
      .map((subpath) => subpath.slice(2))
  );
  const byFileName = new Map();
  const problems = [];
  for (const name of Object.keys(definedIn)) {
    if (taken.has(name)) {
      problems.push(`${name}: "./${name}" is already an entry point`);
    }
    const fileName = name.toLowerCase();
    if (byFileName.has(fileName)) {
      problems.push(
        `${name}: differs from ${byFileName.get(fileName)} only in case`
      );
    }
    byFileName.set(fileName, name);
  }
  if (problems.length) {
    fail(["cannot give every root export its own subpath:", ...problems]);
  }
  fs.mkdirSync(namesDir, { recursive: true });
  const map = {};
  for (const [name, file] of Object.entries(definedIn)) {
    fs.writeFileSync(
      path.join(namesDir, `${name}.js`),
      `"use client";\nexport { ${name} } from "../${builtPathOf(file)}";\n`
    );
    map[name] = `./${name}`;
  }
  fs.writeFileSync(mapFile, `${JSON.stringify(map, null, 2)}\n`);
  return map;
}

const { modules, rootExports } = await rootGraph();
for (const output of [modulesDir, namesDir, mapFile]) {
  fs.rmSync(output, { recursive: true, force: true });
}
const exportsByFile = await buildModules(modules);
const map = writeNamedEntries(findDefiningModules(rootExports, exportsByFile));
// Named, not `export *`: Next.js rejects `export *` in a "use client" file
// that a server component imports.
fs.writeFileSync(
  path.join(distDir, "index.esm.js"),
  `"use client";\nexport { ${Object.keys(map).join(
    ", "
  )} } from "./esm/index.js";\n`
);
fs.rmSync(path.join(distDir, "index.esm.js.map"), { force: true });
console.info(
  `built ${modules.length} ESM modules at "dist/esm" and ${
    Object.keys(map).length
  } root exports at "dist/exports", listed in "dist/exports-map.json", and re-exported them from "dist/index.esm.js"`
);
