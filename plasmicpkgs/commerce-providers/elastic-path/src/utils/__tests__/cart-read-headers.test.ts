import { buildCartReadHeaders } from "../cart-read-headers";

describe("buildCartReadHeaders", () => {
  it("sets Accept-Language from locale and X-Moltin-Currency from currency", () => {
    expect(buildCartReadHeaders({ locale: "en-GB", currency: "GBP" })).toEqual({
      "Accept-Language": "en-GB",
      "X-Moltin-Currency": "GBP",
    });
  });

  it("omits X-Moltin-Currency when currency is absent", () => {
    expect(buildCartReadHeaders({ locale: "en-US" })).toEqual({
      "Accept-Language": "en-US",
    });
  });

  it("omits Accept-Language when locale is absent", () => {
    expect(buildCartReadHeaders({ currency: "USD" })).toEqual({
      "X-Moltin-Currency": "USD",
    });
  });

  it("returns an empty object when neither is present", () => {
    expect(buildCartReadHeaders({})).toEqual({});
    expect(buildCartReadHeaders()).toEqual({});
  });

  it("omits headers for empty-string values", () => {
    expect(buildCartReadHeaders({ locale: "", currency: "" })).toEqual({});
  });
});
