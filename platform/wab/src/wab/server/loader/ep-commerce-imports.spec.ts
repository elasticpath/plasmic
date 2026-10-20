/** @jest-environment node */
import { bundleModules, CodeModule } from "@/wab/server/loader/module-bundler";
import { promises as fs } from "fs";
import { mapValues, omit } from "lodash";
import os from "os";
import path from "path";
import vm from "vm";

jest.mock("@/wab/server/util/s3-util", () => ({
  uploadFilesToS3: jest.fn(),
}));

const pkg = "@elasticpath/plasmic-ep-commerce-elastic-path";
const instantSearch = [
  "instantsearch.js",
  "react-instantsearch",
  "algoliasearch-helper",
];
const sources = {
  EPCatalogSearchProvider: "catalog-search/EPCatalogSearchProvider",
  EPProductGrid: "product-discovery/EPProductGrid",
  EPProductListProvider: "product-discovery/EPProductListProvider",
};
const exportsMap = mapValues(sources, (_, name) => `./${name}`);
const productListPage = `
import { EPProductGrid } from "${pkg}";
import { EPProductListProvider as EPProductListProvider2} from "${pkg}";
export const rendered = [EPProductGrid(), EPProductListProvider2()];
`;

describe("splitEpCommerceImportsPlugin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ep-commerce-imports-"));
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

  async function writePackage(map?: Record<string, string>) {
    const searchImports = instantSearch
      .map((name) => `import "${name}";`)
      .join("\n");
    const files: Record<string, string> = {
      [`node_modules/${pkg}/package.json`]: JSON.stringify({
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
      [`node_modules/${pkg}/dist/index.esm.js`]: [
        searchImports,
        ...Object.keys(sources).map(
          (name) => `export const ${name} = () => "${name} from the root";`
        ),
      ].join("\n"),
    };
    for (const name of instantSearch) {
      files[`node_modules/${name}/package.json`] = JSON.stringify({
        name,
        main: "index.js",
      });
      files[`node_modules/${name}/index.js`] = `globalThis.loaded = "${name}";`;
    }
    if (map) {
      files[`node_modules/${pkg}/dist/exports-map.json`] = JSON.stringify(map);
      for (const [name, source] of Object.entries(sources)) {
        files[`node_modules/${pkg}/dist/esm/${source}.js`] = [
          name === "EPCatalogSearchProvider" ? searchImports : "",
          `export const ${name} = () => "${name} from its own module";`,
        ].join("\n");
        files[
          `node_modules/${pkg}/dist/exports/${name}.js`
        ] = `export { ${name} } from "../esm/${source}.js";`;
      }
    }
    await writeFiles(files);
  }

  async function bundle(page: string) {
    await writeFiles({
      "root-provider.tsx": page,
      "default.css": ".x{color:red}",
      "css-entrypoint.tsx": `import "./default.css";`,
    });
    const output = await bundleModules(dir, [], {}, [], {
      platform: "react",
      loaderVersion: 10,
      mode: "production",
      browserOnly: true,
    });
    const modules = Array.isArray(output.modules)
      ? output.modules
      : output.modules.browser;
    return modules.find(
      (m): m is CodeModule =>
        m.type === "code" && m.fileName === "root-provider.js"
    )!.code;
  }

  function render(code: string) {
    const exports: { rendered?: string[] } = {};
    vm.runInNewContext(code, { exports });
    return exports.rendered;
  }

  it("imports each name from its own entry point", async () => {
    await writePackage(exportsMap);
    expect(render(await bundle(productListPage))).toEqual([
      "EPProductGrid from its own module",
      "EPProductListProvider from its own module",
    ]);
  });

  it("leaves the imports on the root when the package has no exports-map.json", async () => {
    await writePackage();
    expect(render(await bundle(productListPage))).toEqual([
      "EPProductGrid from the root",
      "EPProductListProvider from the root",
    ]);
  });

  it("keeps InstantSearch out of a page that only uses the product list", async () => {
    await writePackage(exportsMap);
    const code = await bundle(productListPage);
    for (const name of instantSearch) {
      expect(code).not.toContain(name);
    }
  });

  it("loads InstantSearch with the product list when the package has no exports-map.json", async () => {
    await writePackage();
    const code = await bundle(productListPage);
    for (const name of instantSearch) {
      expect(code).toContain(name);
    }
  });

  it.each([
    [
      "a name missing from exports-map.json",
      omit(exportsMap, "EPProductListProvider"),
      productListPage,
    ],
    [
      "a namespace import",
      exportsMap,
      `import * as ep from "${pkg}";\nexport const rendered = [ep.EPProductGrid()];`,
    ],
  ])("fails the bundle on %s", async (_, map, page) => {
    await writePackage(map);
    await expect(bundle(page)).rejects.toThrow(
      `Cannot import ${pkg} from its root`
    );
  });
});
