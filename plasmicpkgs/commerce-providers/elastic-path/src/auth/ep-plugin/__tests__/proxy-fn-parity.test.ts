/**
 * Parity between `callEpProxy` call sites and the proxy route's dispatch
 * table. A name with no `FN_DISPATCH` entry 404s at runtime, and the browser
 * fallback is only exercised in Studio canvas — so nothing but a test catches
 * the drift before a designer does.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { EP_PROXY_FN_NAMES } from "../proxy-routes";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Names reachable through `callEpProxy` that the route deliberately does not
 * dispatch yet. Whether a public proxy route may move money is the open
 * question in #371; until that is settled these throw a legible `unknown_fn`
 * rather than silently working. Both still work under SSR.
 */
const KNOWN_UNWIRED = ["applyCartAdjustment", "placeOrder"];

// Matches every real call form in the tree: bare, generic
// (`callEpProxy<Cart>("getCart"`), and the prettier-wrapped variant where the
// name lands on the next line. A `callEpProxy("`-only pattern misses the
// generic sites and passes vacuously.
const CALL_PATTERN = /callEpProxy\s*(?:<[^(]*>)?\s*\(\s*"([^"]+)"/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push.apply(out, sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry) &&
      !/\.test\.tsx?$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

function calledFnNames(): Map<string, string[]> {
  const sites = new Map<string, string[]>();
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, "utf8");
    CALL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_PATTERN.exec(text)) !== null) {
      const name = match[1];
      sites.set(name, (sites.get(name) ?? []).concat(file.slice(SRC_ROOT.length)));
    }
  }
  return sites;
}

describe("callEpProxy / FN_DISPATCH parity", () => {
  it("finds the call sites at all", () => {
    const found = Array.from(calledFnNames().keys());
    // Guards the regex itself: if it silently stops matching the generic or
    // wrapped forms, every other assertion here passes for the wrong reason.
    expect(found).toEqual(
      expect.arrayContaining([
        "getCart",
        "getProductList",
        "addCartItem",
        "removeCartItem",
        ...KNOWN_UNWIRED,
      ])
    );
  });

  it("dispatches every name a call site can send", () => {
    const dispatchable = new Set(EP_PROXY_FN_NAMES.concat(KNOWN_UNWIRED));
    const undispatchable = Array.from(calledFnNames().entries())
      .filter(([name]) => !dispatchable.has(name))
      .map(([name, files]) => `${name} (${files.join(", ")})`);

    expect(
      undispatchable,
      "callEpProxy names the proxy route would 404 on"
    ).toEqual([]);
  });

  it("keeps no stale entries in the unwired allowlist", () => {
    const called = calledFnNames();
    const dispatchable = new Set(EP_PROXY_FN_NAMES);

    expect(
      KNOWN_UNWIRED.filter((name) => !called.has(name)),
      "allowlisted names no call site sends any more"
    ).toEqual([]);
    expect(
      KNOWN_UNWIRED.filter((name) => dispatchable.has(name)),
      "allowlisted names the route now dispatches — drop them from KNOWN_UNWIRED"
    ).toEqual([]);
  });
});
