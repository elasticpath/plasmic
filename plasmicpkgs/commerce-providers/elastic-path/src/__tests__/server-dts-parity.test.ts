/**
 * `dist/server.d.ts` is hand-mirrored in `build-server.mjs`, because tsdx
 * only emits declarations for the client entry's graph. A name added to
 * `src/server.ts` and forgotten there exports at runtime with no type,
 * which breaks consumer typechecks and nothing here.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readFileSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { join } = require("path");

const ROOT = join(__dirname, "..", "..");

/**
 * Every name in an `export { ... } from "..."` / `export type { ... }`.
 * Deduped with `indexOf` rather than a `Set`, because this package's
 * tsconfig targets es5 without `downlevelIteration`, so spreading one
 * does not compile.
 */
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
