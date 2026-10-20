import { build, BuildResult } from "esbuild";
import fs from "fs";
import os from "os";
import path from "path";

const CATALOG_SEARCH = path.resolve(__dirname, "..");

const INSTANTSEARCH_PACKAGES = [
  "instantsearch.js",
  "react-instantsearch",
  "react-instantsearch-core",
  "react-instantsearch-nextjs",
  "algoliasearch-helper",
  "@algolia/autocomplete-core",
  "@elasticpath/catalog-search-instantsearch-adapter",
];

const MINIFIED_BUDGET_BYTES = 60_000;

function bundle(file: string) {
  return build({
    entryPoints: [path.join(CATALOG_SEARCH, file)],
    bundle: true,
    write: false,
    outdir: path.join(os.tmpdir(), "ep-search-typeahead-bundle"),
    format: "esm",
    splitting: true,
    treeShaking: true,
    minify: true,
    metafile: true,
    platform: "browser",
    target: "es6",
    external: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@plasmicapp/*",
      "next",
      "next/*",
    ],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "silent",
  });
}

function packagesIn(result: BuildResult): Set<string> {
  const found = new Set<string>();
  for (const input of Object.keys(result.metafile!.inputs)) {
    for (const name of INSTANTSEARCH_PACKAGES) {
      if (input.includes(`node_modules/${name}/`)) found.add(name);
    }
  }
  return found;
}

function instantSearchModules(): string[] {
  const importsOne = new RegExp(
    `from\\s+["'](?:${INSTANTSEARCH_PACKAGES.map((name) =>
      name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    ).join("|")})(?:/[^"']*)?["']`
  );
  return fs
    .readdirSync(CATALOG_SEARCH)
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) =>
      importsOne.test(fs.readFileSync(path.join(CATALOG_SEARCH, name), "utf8"))
    );
}

function sourceModulesIn(result: BuildResult): string[] {
  return Object.keys(result.metafile!.inputs)
    .filter((input) => !input.includes("node_modules/"))
    .map((input) => path.basename(input));
}

describe("EP Search Typeahead's module graph", () => {
  let typeahead: BuildResult;

  beforeAll(async () => {
    typeahead = await bundle("EPSearchTypeahead.tsx");
  });

  it("contains no InstantSearch package", () => {
    expect([...packagesIn(typeahead)]).toEqual([]);
  });

  it("contains no catalog-search module that imports InstantSearch", () => {
    const offenders = instantSearchModules();
    expect(offenders).toContain("EPSearchHits.tsx");
    expect(
      sourceModulesIn(typeahead).filter((name) => offenders.includes(name))
    ).toEqual([]);
  });

  it("stays within its size budget", () => {
    const bytes = typeahead
      .outputFiles!.filter((file) => file.path.endsWith(".js"))
      .reduce((total, file) => total + file.contents.length, 0);

    expect(bytes).toBeLessThan(MINIFIED_BUDGET_BYTES);
  });

  it("would catch InstantSearch, as EP Search Hits' graph shows", async () => {
    const hits = await bundle("EPSearchHits.tsx");
    expect(packagesIn(hits)).toContain("react-instantsearch-core");
    expect(packagesIn(hits)).toContain("instantsearch.js");
  });
});
