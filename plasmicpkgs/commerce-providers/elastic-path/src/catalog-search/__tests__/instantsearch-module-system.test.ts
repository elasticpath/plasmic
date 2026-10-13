/**
 * The InstantSearch packages must load through one module system. A `require`
 * of one beside an `import` of another loads two `react-instantsearch-core`
 * copies with two contexts, and every server render fails with
 * `Invariant failed`.
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../..");

const INSTANTSEARCH_REQUIRE =
  /require\(\s*["'](?:react-instantsearch(?:-core|-nextjs)?|instantsearch\.js)(?:\/[^"']*)?["']\s*\)/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

it("loads the InstantSearch packages with import, never require", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => INSTANTSEARCH_REQUIRE.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));

  expect(offenders).toEqual([]);
});

it("recognises a require of an InstantSearch package", () => {
  expect(
    INSTANTSEARCH_REQUIRE.test('require("react-instantsearch-nextjs")')
  ).toBe(true);
  expect(
    INSTANTSEARCH_REQUIRE.test("require('instantsearch.js/es/lib/server')")
  ).toBe(true);
});
