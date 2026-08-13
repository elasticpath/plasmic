import pkg from "../package.json";
import { registerAll, sampleFieldsContext } from "./index";

function metaFor(name: string) {
  const registered: Array<[unknown, any]> = [];
  registerAll({
    registerFunction: (fn: any, meta: any) => registered.push([fn, meta]),
  });
  const found = registered.find(([, meta]) => meta.name === name);
  if (!found) {
    throw new Error(`${name} was not registered`);
  }
  return found[1];
}

describe("queryEntries registration", () => {
  it("declares the query's arguments as one flattened parameter object", () => {
    const meta = metaFor("queryEntries");

    expect(meta.params).toHaveLength(1);
    const [opts] = meta.params;
    expect(opts.type).toBe("object");
    expect(opts.display).toBe("flatten");
    expect(Object.keys(opts.fields)).toEqual([
      "host",
      "clientId",
      "customApi",
      "filter",
      "sort",
      "limit",
      "offset",
    ]);
  });

  it("offers every attribute Elastic Path can sort by, both ways, plus unsorted", () => {
    const meta = metaFor("queryEntries");
    const sort = meta.params[0].fields.sort;

    expect(sort.options.map((o: { value: string }) => o.value)).toEqual([
      "-created_at",
      "created_at",
      "-updated_at",
      "updated_at",
      "id",
      "-id",
      "unsorted",
    ]);
  });

  // Characterisation, born green, and worth keeping: importPath is what
  // generated code imports the function from. If the published name and this
  // string drift apart, projects generate an import of a package that does not
  // exist — the same failure the commerce provider's hostless entry already
  // carries, and one nothing else in the suite would notice.
  it("imports the function from the name this package publishes under", () => {
    expect(metaFor("queryEntries").importPath).toBe(pkg.name);
  });

  it("hints the filter with the fields sampled for the editor", () => {
    const meta = metaFor("queryEntries");
    const { defaultValueHint } = meta.params[0].fields.filter;

    const hint = defaultValueHint([{ customApi: "faqs" }], {
      fields: [{ name: "question", type: "string" }],
    });

    expect(hint).toContain("question (string)");
  });

  it("wires the editor's field sampling to the entries query", () => {
    expect(metaFor("queryEntries").fnContext).toBe(sampleFieldsContext);
  });

  // Characterisation: the outer transport spec required getEntry to be
  // registered under that name, but nothing asserted the arguments Studio
  // renders for it.
  it("declares the single-entry query's arguments, ending with the entry", () => {
    const meta = metaFor("getEntry");

    expect(meta.namespace).toBe("epCms");
    expect(meta.isQuery).toBe(true);
    expect(meta.importPath).toBe(pkg.name);
    expect(Object.keys(meta.params[0].fields)).toEqual([
      "host",
      "clientId",
      "customApi",
      "entry",
    ]);
  });

  // The canvas package entry calls register with no arguments and relies on the
  // host's global registry, the same as every sibling package does.
  it("registers into the host's registry when no loader is supplied", () => {
    (globalThis as any).__PlasmicFunctionsRegistry = [];

    registerAll();

    const names = ((globalThis as any).__PlasmicFunctionsRegistry as any[]).map(
      (r) => r.meta.name
    );
    expect(names).toContain("queryEntries");
  });
});
