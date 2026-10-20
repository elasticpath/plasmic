import { getLoaderForPath } from "@/wab/server/loader/bundle-utils";
import * as parser from "@babel/parser";
import { Plugin as EsbuildPlugin, PluginBuild } from "esbuild";
import { promises as fs } from "fs";
import path from "path";

const EP_COMMERCE_PACKAGE = "@elasticpath/plasmic-ep-commerce-elastic-path";

type ExportsMap = Map<string, string>;

const SPLIT_EP_COMMERCE_NOTE =
  "This bundle imports each name from its own entry point in the package, as its exports-map.json says. " +
  "Only named and default imports in generated code can be split. " +
  "An import from the package root would load a second copy of the package, with its own state.";

export const splitEpCommerceImportsPlugin: EsbuildPlugin = {
  name: "split-ep-commerce-imports",
  setup(build) {
    let exportsMap: Promise<ExportsMap | undefined> | undefined;
    const getExportsMap = () =>
      (exportsMap ??= readEpCommerceExportsMap(build));

    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      if (args.path.includes(`${path.sep}node_modules${path.sep}`)) {
        return undefined;
      }
      const contents = await fs.readFile(args.path, "utf8");
      if (!contents.includes(EP_COMMERCE_PACKAGE)) {
        return undefined;
      }
      const map = await getExportsMap();
      if (!map) {
        return undefined;
      }
      const loader = getLoaderForPath(args.path);
      const { code, unmapped } = splitEpCommerceImports(contents, loader, map);
      if (unmapped.length > 0) {
        return {
          errors: unmapped.map(({ name, line, column }) => ({
            text: `${EP_COMMERCE_PACKAGE}/exports-map.json has no entry point for "${name}"`,
            location: { file: args.path, line, column },
            notes: [{ text: SPLIT_EP_COMMERCE_NOTE }],
          })),
        };
      }
      return { contents: code, loader };
    });

    build.onResolve(
      { filter: /^@elasticpath\/plasmic-ep-commerce-elastic-path$/ },
      async () => {
        if (!(await getExportsMap())) {
          return undefined;
        }
        return {
          errors: [
            {
              text: `${EP_COMMERCE_PACKAGE} cannot be imported from its root in this bundle`,
              notes: [{ text: SPLIT_EP_COMMERCE_NOTE }],
            },
          ],
        };
      }
    );
  },
};

async function readEpCommerceExportsMap(
  build: PluginBuild
): Promise<ExportsMap | undefined> {
  const resolved = await build.resolve(
    `${EP_COMMERCE_PACKAGE}/exports-map.json`,
    {
      kind: "import-statement",
      resolveDir: build.initialOptions.absWorkingDir ?? process.cwd(),
    }
  );
  if (resolved.errors.length > 0) {
    return undefined;
  }
  return new Map(
    Object.entries(JSON.parse(await fs.readFile(resolved.path, "utf8")))
  );
}

function splitEpCommerceImports(
  code: string,
  loader: "tsx" | "ts" | "js",
  map: ExportsMap
) {
  const ast = parser.parse(code, {
    sourceType: "module",
    plugins: loader === "ts" ? ["typescript"] : ["typescript", "jsx"],
  });
  const unmapped: { name: string; line: number; column: number }[] = [];
  let result = code;
  // Edit from the end, so that the offsets of earlier imports stay valid
  for (const node of [...ast.program.body].reverse()) {
    if (
      node.type !== "ImportDeclaration" ||
      node.source.value !== EP_COMMERCE_PACKAGE ||
      node.importKind === "type" ||
      node.specifiers.length === 0 ||
      node.specifiers.some((s) => s.type === "ImportNamespaceSpecifier")
    ) {
      continue;
    }
    const imports: string[] = [];
    for (const spec of node.specifiers) {
      let name: string;
      let binding: string;
      if (spec.type === "ImportDefaultSpecifier") {
        name = "default";
        binding = spec.local.name;
      } else if (spec.type === "ImportSpecifier" && spec.importKind !== "type") {
        name =
          spec.imported.type === "Identifier"
            ? spec.imported.name
            : spec.imported.value;
        binding = `{ ${code.slice(spec.start!, spec.end!)} }`;
      } else {
        continue;
      }
      const file = map.get(name);
      if (!file) {
        unmapped.push({
          name,
          line: spec.loc!.start.line,
          column: spec.loc!.start.column,
        });
        continue;
      }
      imports.push(
        `import ${binding} from "${path.posix.join(
          EP_COMMERCE_PACKAGE,
          file
        )}";`
      );
    }
    result =
      result.slice(0, node.start!) + imports.join("\n") + result.slice(node.end!);
  }
  return { code: result, unmapped };
}
