import {
  epShopperHeaders,
  EP_MULTI_LOCATION_INVENTORY_HEADER,
} from "../ep-shopper-headers";
import { EP_ACCOUNT_TOKEN_HEADER } from "../../auth/ep-plugin/envelope";

describe("epShopperHeaders", () => {
  it("asks for multi-location inventory on every shopper call", () => {
    expect(epShopperHeaders({})[EP_MULTI_LOCATION_INVENTORY_HEADER]).toBe(
      "true"
    );
  });

  it("carries the selected organisation's credential when there is one", () => {
    const headers = epShopperHeaders({ accountToken: "acct-token" });

    expect(headers[EP_ACCOUNT_TOKEN_HEADER]).toBe("acct-token");
  });

  it("sends no account header when no organisation is selected", () => {
    expect(epShopperHeaders({})).not.toHaveProperty(EP_ACCOUNT_TOKEN_HEADER);
  });

  // The point of the function: spread last, a caller's own headers lose. If
  // this ever spreads first, the guarantee quietly becomes a default again.
  it("wins over a caller's own headers when spread last", () => {
    const merged = {
      [EP_MULTI_LOCATION_INVENTORY_HEADER]: "false",
      [EP_ACCOUNT_TOKEN_HEADER]: "someone-elses-account",
      ...epShopperHeaders({ accountToken: "acct-token" }),
    };

    expect(merged[EP_MULTI_LOCATION_INVENTORY_HEADER]).toBe("true");
    expect(merged[EP_ACCOUNT_TOKEN_HEADER]).toBe("acct-token");
  });
});
