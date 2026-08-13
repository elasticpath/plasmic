import pkg from "../package.json";
import { registerAll } from "./index";

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
});
