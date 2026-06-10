/**
 * order-custom-fields — flattening + best-effort PUT of order flow fields.
 */
export {}; // mark as a module (file uses only require()) so tsc scopes its top-level consts

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  updateAnOrder: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as { updateAnOrder: jest.Mock };

// esbuild does not hoist jest.mock(); require() after the mock so the SDK
// interception is in place before the module under test binds it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toOrderCustomFields, persistOrderCustomFields } =
  require("../order-custom-fields") as typeof import("../order-custom-fields");

beforeEach(() => {
  jest.clearAllMocks();
  epSdk.updateAnOrder.mockResolvedValue({ data: { data: { id: "order-1" } }, error: undefined });
});

describe("toOrderCustomFields", () => {
  it("passes raw values through (no { type, value } envelope) and drops empties", () => {
    expect(
      toOrderCustomFields({
        industry: "Tech",
        marketing: true,
        vat: "",
        count: 3,
      })
    ).toEqual({ industry: "Tech", marketing: true, count: 3 });
  });

  it("returns undefined for nullish or all-empty input", () => {
    expect(toOrderCustomFields(undefined)).toBeUndefined();
    expect(toOrderCustomFields({ a: "", b: "" })).toBeUndefined();
  });
});

describe("persistOrderCustomFields", () => {
  const base = { host: "https://api.test.com", token: "cc-token", orderId: "order-1" };

  it("PUTs the flattened fields under data, with an explicit Bearer header", async () => {
    await persistOrderCustomFields({
      ...base,
      input: { industry: "Tech", marketing: true, vat: "" },
    });

    expect(epSdk.updateAnOrder).toHaveBeenCalledTimes(1);
    const call = epSdk.updateAnOrder.mock.calls[0][0];
    expect(call.path).toEqual({ orderID: "order-1" });
    expect(call.baseUrl).toBe("https://api.test.com");
    // explicit client_credentials Bearer header (not via the SDK auth layer)
    expect(call.headers).toEqual({ Authorization: "Bearer cc-token" });
    expect(call.body.data).toEqual({
      type: "order",
      id: "order-1",
      industry: "Tech",
      marketing: true,
    });
    // dropped empty value is not sent
    expect(call.body.data.vat).toBeUndefined();
  });

  it("does not call the API when there is nothing to write", async () => {
    await persistOrderCustomFields({ ...base, input: undefined });
    await persistOrderCustomFields({ ...base, input: { a: "" } });
    expect(epSdk.updateAnOrder).not.toHaveBeenCalled();
  });

  it("swallows thrown API errors (the order is already placed)", async () => {
    epSdk.updateAnOrder.mockRejectedValue(new Error("EP unavailable"));
    await expect(
      persistOrderCustomFields({ ...base, input: { industry: "Tech" } })
    ).resolves.toBeUndefined();
  });

  it("swallows soft (non-throwing) EP error responses", async () => {
    epSdk.updateAnOrder.mockResolvedValue({
      error: { errors: [{ code: "gateway.scopes.authorise" }] },
    });
    await expect(
      persistOrderCustomFields({ ...base, input: { industry: "Tech" } })
    ).resolves.toBeUndefined();
  });
});
