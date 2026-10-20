/** @jest-environment node */
import { splitEpCommerceImportsPlugin } from "@/wab/server/loader/ep-commerce-imports";
import {
  bundleModules,
  CodeModule,
} from "@/wab/server/loader/module-bundler";
import esbuild, { Metafile } from "esbuild";
import { promises as fs } from "fs";
import { mapValues, omit } from "lodash";
import os from "os";
import path from "path";
import vm from "vm";

jest.mock("@/wab/server/util/s3-util", () => ({
  uploadFilesToS3: jest.fn(),
}));

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
  const modules = {
    EPCatalogSearchProvider: "catalog-search/EPCatalogSearchProvider",
    EPProductGrid: "product-discovery/EPProductGrid",
    EPProductListProvider: "product-discovery/EPProductListProvider",
  };
  const exportsMap = mapValues(modules, (_, name) => `./${name}`);

  let dir: string;

  beforeEach(async () => {
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

  async function writePackage(map: Record<string, string> | undefined) {
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

  it("splits the imports in the loader's browser and server bundles", async () => {
    await writePackage(exportsMap);
    await writeFiles({
      "root-provider.tsx": `
import { EPProductGrid, EPProductListProvider as List } from "${pkg}";
export const rendered = [EPProductGrid(), List()];
`,
      "default.css": ".x{color:red}",
      "css-entrypoint.tsx": `import "./default.css";`,
    });
    const output = await bundleModules(dir, [], {}, [], {
      platform: "react",
      loaderVersion: 10,
      mode: "production",
      browserOnly: false,
    });
    for (const target of ["browser", "server"] as const) {
      const bundled = Array.isArray(output.modules)
        ? output.modules
        : output.modules[target];
      const rootProvider = bundled.find(
        (m): m is CodeModule =>
          m.type === "code" && m.fileName === "root-provider.js"
      )!;
      const exports: { rendered?: string[] } = {};
      vm.runInNewContext(rootProvider.code, { exports });
      expect(exports.rendered).toEqual([
        "EPProductGrid from its own module",
        "EPProductListProvider from its own module",
      ]);
    }
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
