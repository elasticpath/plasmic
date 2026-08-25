/**
 * Guard: every registered `importName` must exist on the entry point its
 * `importPath` names.
 *
 * Studio resolves components and functions through live JS references, so the
 * dev host works even when these strings are wrong. The loader is the only
 * consumer that resolves them — it emits `import { <importName> } from
 * "<importPath>"` into generated code, and esbuild fails the whole project
 * bundle when the symbol is not on the entry's public surface. That is how 15
 * components and 8 server functions shipped unreachable across 7 releases.
 */

import { buildSync } from "esbuild";
import * as path from "path";
import { registerEpCustomFunctions } from "../ep-server-functions/register-custom-functions";
import { registerAll } from "../index";

const PKG = "@elasticpath/plasmic-ep-commerce-elastic-path";
const SRC = path.join(__dirname, "..");

/** Bundle an entry the way the loader does and read its export names. */
function exportsOf(entry: string): Set<string> {
  const { outputFiles } = buildSync({
    entryPoints: [path.join(SRC, entry)],
    bundle: true,
    write: false,
    format: "esm",
    packages: "external",
    platform: "neutral",
    outfile: "out.mjs",
    metafile: true,
    logLevel: "silent",
  });
  const code = outputFiles[0].text;
  const block = /^export \{$([\s\S]*?)^\};?$/m.exec(code);
  if (!block) {
    throw new Error(`No export block found in bundle for ${entry}`);
  }
  return new Set(
    block[1]
      .split(",")
      .map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim()
      )
      .filter(Boolean)
  );
}

/** Replay registerAll against a recording loader to collect component metas. */
function registeredComponents(): { importName: string; importPath: string }[] {
  const collected: { importName: string; importPath: string }[] = [];
  const record = (component: any, meta: any) => {
    collected.push({
      importName: meta.importName ?? meta.name,
      importPath: meta.importPath,
    });
  };
  registerAll({
    registerComponent: record,
    registerGlobalContext: record,
  } as any);
  return collected;
}

function registeredFunctions(): { importName: string; importPath: string }[] {
  const collected: { importName: string; importPath: string }[] = [];
  registerEpCustomFunctions({
    registerFunction: (_fn: any, meta: any) => {
      // `registerFunction` has no `importName`; Studio stores `meta.name` as
      // the symbol the loader imports. See `createCustomFunctionFromRegistration`.
      collected.push({ importName: meta.name, importPath: meta.importPath });
    },
  });
  return collected;
}

describe("registered importName resolves against the declared importPath", () => {
  const surfaces: Record<string, Set<string>> = {
    [PKG]: exportsOf("index.tsx"),
    [`${PKG}/server`]: exportsOf("server.ts"),
  };

  const all = [...registeredComponents(), ...registeredFunctions()];

  it("registers something", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it("only declares importPaths this test knows how to check", () => {
    const unknown = Array.from(
      new Set(all.map((r) => r.importPath).filter((p) => !(p in surfaces)))
    );
    expect(unknown).toEqual([]);
  });

  it("exports every registered importName from its entry point", () => {
    const missing = all
      .filter(
        (r) =>
          r.importPath in surfaces && !surfaces[r.importPath].has(r.importName)
      )
      .map((r) => `${r.importName} (expected in ${r.importPath})`);
    expect(Array.from(new Set(missing)).sort()).toEqual([]);
  });
});
