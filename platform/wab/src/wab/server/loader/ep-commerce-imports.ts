import { Plugin as EsbuildPlugin } from "esbuild";
import { readFileSync, promises as fs } from "fs";
import { createRequire } from "module";
import path from "path";

const EP_COMMERCE_PACKAGE = "@elasticpath/plasmic-ep-commerce-elastic-path";
const ROOT_IMPORT =
  /import\s*\{([^}]*)\}\s*from\s*"@elasticpath\/plasmic-ep-commerce-elastic-path";?/g;

export const splitEpCommerceImportsPlugin: EsbuildPlugin = {
  name: "split-ep-commerce-imports",
  setup(build) {
    const exportsMap = readExportsMap(
      build.initialOptions.absWorkingDir ?? process.cwd()
    );
    if (!exportsMap) {
      return;
    }

    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      if (args.path.includes(`${path.sep}node_modules${path.sep}`)) {
        return undefined;
      }
      const code = await fs.readFile(args.path, "utf8");
      return {
        contents: code.replace(ROOT_IMPORT, (_, names: string) =>
          splitImport(names, exportsMap)
        ),
        loader: "tsx",
      };
    });

    build.onResolve(
      { filter: /^@elasticpath\/plasmic-ep-commerce-elastic-path$/ },
      () => ({
        errors: [
          {
            text: `Cannot import ${EP_COMMERCE_PACKAGE} from its root: this bundle imports each name from its own entry point, and the root would add a second copy of the package`,
          },
        ],
      })
    );
  },
};

function readExportsMap(dir: string) {
  let file: string;
  try {
    file = createRequire(path.join(dir, "package.json")).resolve(
      `${EP_COMMERCE_PACKAGE}/exports-map.json`
    );
  } catch {
    return undefined;
  }
  return new Map<string, string>(
    Object.entries(JSON.parse(readFileSync(file, "utf8")))
  );
}

function splitImport(names: string, exportsMap: Map<string, string>) {
  return names
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const subpath = exportsMap.get(specifier.split(/\s+as\s+/)[0]);
      const from = subpath
        ? path.posix.join(EP_COMMERCE_PACKAGE, subpath)
        : EP_COMMERCE_PACKAGE;
      return `import { ${specifier} } from "${from}";`;
    })
    .join("\n");
}
