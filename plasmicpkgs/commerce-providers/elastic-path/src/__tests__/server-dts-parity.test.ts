// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readFileSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { join } = require("path");

const ROOT = join(__dirname, "..", "..");

function exportedNames(source: string): string[] {
  const names: string[] = [];
  const blocks = source.match(/export\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'][^"']+["']/g);
  for (const block of blocks ?? []) {
    const inner = block.slice(block.indexOf("{") + 1, block.indexOf("}"));
    for (const raw of inner.split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && names.indexOf(name) < 0) names.push(name);
    }
  }
  return names;
}

describe("dist/server.d.ts mirrors src/server.ts", () => {
  it("declares every name the server entry exports", () => {
    const declared = exportedNames(
      readFileSync(join(ROOT, "build-server.mjs"), "utf8")
    );
    const exported = exportedNames(
      readFileSync(join(ROOT, "src", "server.ts"), "utf8")
    );

    expect(exported.filter((name) => !declared.includes(name))).toEqual([]);
  });
});
