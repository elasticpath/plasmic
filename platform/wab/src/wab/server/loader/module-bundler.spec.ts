/** @jest-environment node */
import {
  externalizeCssUrlsPlugin,
  splitEpCommerceImportsPlugin,
} from "@/wab/server/loader/module-bundler";
import esbuild, { Metafile } from "esbuild";
import { promises as fs } from "fs";
import { glob } from "glob";
import { mapValues, omit } from "lodash";
import os from "os";
import path from "path";
import vm from "vm";

describe("externalizeCssUrlsPlugin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "css-url-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Generated CSS can reference url(...) paths that don't exist on the build
  // server's disk -- e.g. a relative or root-absolute image path that the user
  // pasted in Studio, meant to resolve against their deployed site at runtime.
  // esbuild would otherwise try to resolve these and fail the whole bundle with
  // "Could not resolve ...". The plugin marks every url-token external, leaving
  // the original url(...) text intact for the browser to resolve at runtime.
  const cssWithUnresolvableUrls = [
    `.root-absolute { background-image: url("/static/missing-image.png"); }`,
    `.relative { background: url(./does-not-exist.svg) no-repeat; }`,
    `.parent-relative { mask-image: url(../assets/nope.png); }`,
  ].join("\n");

  it("preserves unresolvable url() in a css__*.css minify pass", async () => {
    await fs.writeFile(path.join(dir, "css__test.css"), cssWithUnresolvableUrls);
    const outdir = path.join(dir, "out");

    // Mirrors the component-css esbuild build in module-bundler.ts.
    await expect(
      esbuild.build({
        entryPoints: glob.sync(path.join(dir, "css__*.css")),
        minify: true,
        outdir,
        target: ["safari13"],
        plugins: [externalizeCssUrlsPlugin],
      })
    ).resolves.toBeDefined();

    const out = (
      await fs.readFile(path.join(outdir, "css__test.css"))
    ).toString();
    expect(out).toContain("url(/static/missing-image.png)");
    expect(out).toContain("url(./does-not-exist.svg)");
    expect(out).toContain("url(../assets/nope.png)");
  });

  it("preserves unresolvable url() when bundling (css-entrypoint pass)", async () => {
    await fs.writeFile(path.join(dir, "css__test.css"), cssWithUnresolvableUrls);
    const outdir = path.join(dir, "out");

    await expect(
      esbuild.build({
        entryPoints: glob.sync(path.join(dir, "css__*.css")),
        minify: true,
        outdir,
        bundle: true,
        target: ["safari13"],
        plugins: [externalizeCssUrlsPlugin],
      })
    ).resolves.toBeDefined();

    const out = (
      await fs.readFile(path.join(outdir, "css__test.css"))
    ).toString();
    expect(out).toContain("url(/static/missing-image.png)");
    expect(out).toContain("url(./does-not-exist.svg)");
  });

  // This is the build that actually fails in production: render modules
  // `import "./css__*.css"`, so the JS bundle transitively processes that CSS
  // and resolves its url() tokens. The plugin must be on this build too.
  it("preserves unresolvable url() when a JS module imports the CSS", async () => {
    await fs.writeFile(path.join(dir, "css__test.css"), cssWithUnresolvableUrls);
    await fs.writeFile(
      path.join(dir, "render__test.tsx"),
      `import "./css__test.css";\nexport const X = 1;\n`
    );
    const outdir = path.join(dir, "out");

    await expect(
      esbuild.build({
        entryPoints: [path.join(dir, "render__test.tsx")],
        bundle: true,
        format: "esm",
        minify: true,
        outdir,
        absWorkingDir: dir,
        target: "es6",
        plugins: [externalizeCssUrlsPlugin],
      })
    ).resolves.toBeDefined();

    const cssFile = (await fs.readdir(outdir)).find((f) => f.endsWith(".css"));
    const out = (
      await fs.readFile(path.join(outdir, cssFile!))
    ).toString();
    expect(out).toContain("url(/static/missing-image.png)");
    expect(out).toContain("url(./does-not-exist.svg)");
  });

  it("fails to bundle unresolvable url() without the plugin (regression guard)", async () => {
    // Sanity check that the plugin is doing the work: the same JS-imports-CSS
    // build without it fails with esbuild's "Could not resolve" error -- the
    // exact production failure.
    await fs.writeFile(path.join(dir, "css__test.css"), cssWithUnresolvableUrls);
    await fs.writeFile(
      path.join(dir, "render__test.tsx"),
      `import "./css__test.css";\nexport const X = 1;\n`
    );

    await expect(
      esbuild.build({
        entryPoints: [path.join(dir, "render__test.tsx")],
        bundle: true,
        format: "esm",
        minify: true,
        outdir: path.join(dir, "out"),
        absWorkingDir: dir,
        target: "es6",
        logLevel: "silent",
      })
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe("splitEpCommerceImportsPlugin", () => {
  const pkg = "@elasticpath/plasmic-ep-commerce-elastic-path";
  const pkgDir = `node_modules/${pkg}`;
  const instantSearchPackages = [
    "instantsearch.js",
    "react-instantsearch",
    "algoliasearch-helper",
  ];
  const searchImports = instantSearchPackages
    .map((name) => `import "${name}";`)
    .join("\n");
  // The source module that defines each root export
  const modules = {
    EPCatalogSearchProvider: "catalog-search/EPCatalogSearchProvider",
    EPProductGrid: "product-discovery/EPProductGrid",
    EPProductListProvider: "product-discovery/EPProductListProvider",
  };
  const exportsMap = mapValues(modules, (_, name) => `./${name}`);

  let dir: string;

  beforeEach(async () => {
    // The real path, as esbuild reports output paths with symlinks resolved
    dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "ep-commerce-split-test-"))
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeFiles(files: Record<string, string>) {
    for (const [file, contents] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), contents);
    }
  }

  /**
   * A stand-in for the package, laid out as its build lays it out: a root
   * module that reaches every component and InstantSearch. When `map` is
   * given, also one ESM file per source module, one entry point per export
   * that re-exports it, and `exports-map.json`. Versions before these have
   * only the root.
   */
  async function writePackage(map: Record<string, string> | undefined) {
    // Each InstantSearch package leaves its name in any bundle it lands in
    for (const name of instantSearchPackages) {
      await writeFiles({
        [`node_modules/${name}/package.json`]: JSON.stringify({
          name,
          main: "index.js",
        }),
        [`node_modules/${name}/index.js`]: `globalThis.loaded = "${name}";`,
      });
    }
    await writeFiles({
      [`${pkgDir}/package.json`]: JSON.stringify({
        name: pkg,
        exports: {
          ".": "./dist/index.esm.js",
          ...(map && {
            "./exports-map.json": "./dist/exports-map.json",
            "./*": "./dist/exports/*.js",
          }),
        },
        sideEffects: ["./dist/index.esm.js"],
      }),
      [`${pkgDir}/dist/index.esm.js`]: [
        searchImports,
        ...Object.keys(modules).map(
          (name) => `export const ${name} = () => "${name} from the root";`
        ),
      ].join("\n"),
    });
    if (map) {
      for (const [name, source] of Object.entries(modules)) {
        await writeFiles({
          [`${pkgDir}/dist/esm/${source}.js`]: [
            `"use client";`,
            name === "EPCatalogSearchProvider" ? searchImports : "",
            `export const ${name} = () => "${name} from its own module";`,
          ].join("\n"),
          [`${pkgDir}/dist/exports/${name}.js`]: [
            `"use client";`,
            `export { ${name} } from "../esm/${source}.js";`,
          ].join("\n"),
        });
      }
      await writeFiles({
        [`${pkgDir}/dist/exports-map.json`]: JSON.stringify(map),
      });
    }
  }

  /** Bundles and runs one generated module, and returns its `rendered`. */
  async function renderPage(source: string) {
    await writeFiles({ "page.tsx": source });
    const { outputFiles } = await esbuild.build({
      entryPoints: ["page.tsx"],
      bundle: true,
      format: "cjs",
      platform: "node",
      absWorkingDir: dir,
      outdir: "out",
      write: false,
      logLevel: "silent",
      plugins: [splitEpCommerceImportsPlugin],
    });
    const module = { exports: {} as { rendered?: string[] } };
    vm.runInNewContext(outputFiles[0].text, {
      module,
      exports: module.exports,
    });
    return module.exports.rendered;
  }

  /**
   * Bundles a product list page and a search page with the loader's split
   * settings, and returns all the code that each page loads.
   */
  async function bundlePages() {
    await writeFiles({
      "page-products.tsx": `
import { EPProductGrid, EPProductListProvider } from "${pkg}";
export default () => [EPProductListProvider(), EPProductGrid()];
`,
      "page-search.tsx": `
import { EPCatalogSearchProvider } from "${pkg}";
export default () => EPCatalogSearchProvider();
`,
    });
    const { metafile, outputFiles } = await esbuild.build({
      entryPoints: ["page-products.tsx", "page-search.tsx"],
      bundle: true,
      format: "esm",
      splitting: true,
      treeShaking: true,
      minify: true,
      metafile: true,
      absWorkingDir: dir,
      outdir: "out",
      entryNames: "[name]",
      preserveSymlinks: true,
      write: false,
      logLevel: "silent",
      plugins: [splitEpCommerceImportsPlugin],
    });
    const codeOf = new Map(outputFiles.map((f) => [f.path, f.text]));
    const loadedBy = (entry: string) => {
      const files = new Set<string>();
      const visit = (file: string) => {
        if (files.has(file)) {
          return;
        }
        files.add(file);
        (metafile as Metafile).outputs[file].imports
          .filter((i) => i.kind === "import-statement" && !i.external)
          .forEach((i) => visit(i.path));
      };
      visit(`out/${entry}.js`);
      return [...files].map((f) => codeOf.get(path.join(dir, f))).join("\n");
    };
    return {
      products: loadedBy("page-products"),
      search: loadedBy("page-search"),
    };
  }

  it("imports each name from its own entry point, keeping aliases", async () => {
    await writePackage(exportsMap);
    expect(
      await renderPage(`
import { EPProductGrid, type EPProductGridProps, EPProductListProvider as List } from "${pkg}";
import type { EPCatalogSearchProviderProps } from "${pkg}";
const props: EPProductGridProps | EPCatalogSearchProviderProps = {};
export const rendered = [EPProductGrid(), List()];
`)
    ).toEqual([
      "EPProductGrid from its own module",
      "EPProductListProvider from its own module",
    ]);
  });

  it("leaves imports on the root when the package has no exports-map.json", async () => {
    await writePackage(undefined);
    expect(
      await renderPage(`
import { EPProductGrid, EPProductListProvider as List } from "${pkg}";
export const rendered = [EPProductGrid(), List()];
`)
    ).toEqual(["EPProductGrid from the root", "EPProductListProvider from the root"]);
  });

  // Importing the missing name from the root would load a second copy of the
  // package beside the entry points.
  it("fails the bundle on a name that exports-map.json does not list", async () => {
    await writePackage(omit(exportsMap, "EPProductListProvider"));
    await expect(
      renderPage(`
import { EPProductGrid, EPProductListProvider } from "${pkg}";
export const rendered = [EPProductGrid(), EPProductListProvider()];
`)
    ).rejects.toThrow(
      `${pkg}/exports-map.json has no entry point for "EPProductListProvider"`
    );
  });

  it("fails the bundle on an import of the root that it cannot split", async () => {
    await writePackage(exportsMap);
    await expect(
      renderPage(`
import * as ep from "${pkg}";
export const rendered = [ep.EPProductGrid()];
`)
    ).rejects.toThrow(`${pkg} cannot be imported from its root in this bundle`);
  });

  it("keeps InstantSearch out of a page that only uses the product list", async () => {
    await writePackage(exportsMap);
    const { products, search } = await bundlePages();
    for (const name of instantSearchPackages) {
      expect(products).not.toContain(name);
      expect(search).toContain(name);
    }
    expect(products).not.toContain("from the root");
  });

  it("loads InstantSearch on every page without exports-map.json (regression guard)", async () => {
    await writePackage(undefined);
    const { products } = await bundlePages();
    for (const name of instantSearchPackages) {
      expect(products).toContain(name);
    }
  });
});
