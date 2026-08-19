import { cartLoadState } from "../use-ep-cart";

describe("cartLoadState", () => {
  it("is loading only while the fetch has not resolved", () => {
    expect(cartLoadState(undefined, undefined)).toBe("loading");
  });

  it("treats a resolved absent cart as empty, not loading", () => {
    // A shopper with no cart resolves to null. Reading that as "still loading"
    // is what pinned the drawer on "Loading cart…" forever.
    expect(cartLoadState(null, undefined)).toBe("ready");
  });

  it("reports an error ahead of anything else", () => {
    expect(cartLoadState(undefined, new Error("boom"))).toBe("error");
  });
});
