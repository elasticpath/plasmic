import { catalogSearchErrorCopy } from "../search-error-copy";

function coded(code: string): Error {
  const err = new Error("ep proxy multiSearch failed") as Error & {
    code?: string;
  };
  err.code = code;
  return err;
}

describe("catalogSearchErrorCopy", () => {
  it("names an unmounted route as the cause", () => {
    expect(catalogSearchErrorCopy(coded("route_not_found"))).toContain(
      "does not serve the Elastic Path route"
    );
  });

  it("tells a route that is too old from one that is missing", () => {
    expect(catalogSearchErrorCopy(coded("unknown_fn"))).not.toBe(
      catalogSearchErrorCopy(coded("route_not_found"))
    );
    expect(catalogSearchErrorCopy(coded("unknown_fn"))).toContain("older");
  });

  it("tells the shopper to refresh when the session went", () => {
    expect(catalogSearchErrorCopy(coded("no_session"))).toContain("Refresh");
  });

  it("falls back to generic copy for dispatch_failed", () => {
    // Production sanitizes every unnamed failure to this code, so repeating
    // it would tell the shopper nothing they can act on.
    expect(catalogSearchErrorCopy(coded("dispatch_failed"))).toBe(
      "Search is unavailable right now. Try again in a moment."
    );
  });

  it("never blames the adapter install or a store setting", () => {
    const messages = [
      "route_not_found",
      "unknown_fn",
      "no_session",
      "dispatch_failed",
    ]
      .map((code) => catalogSearchErrorCopy(coded(code)))
      .concat(catalogSearchErrorCopy(new Error("boom")));

    for (const message of messages) {
      expect(message).not.toMatch(/adapter is installed|Catalog Search enabled/i);
    }
  });

  it("does not repeat an uncoded message verbatim", () => {
    expect(catalogSearchErrorCopy(new Error("ECONNREFUSED 127.0.0.1:3000"))).toBe(
      "Search is unavailable right now. Try again in a moment."
    );
  });
});
