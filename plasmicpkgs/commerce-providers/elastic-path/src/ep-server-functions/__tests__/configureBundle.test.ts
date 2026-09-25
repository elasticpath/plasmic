const mockConfigureByContextProduct = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  configureByContextProduct: (...args: unknown[]) =>
    mockConfigureByContextProduct(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epConfigureBundle } = require("../configureBundle");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const SELECTED = { "option-a": { "product-1": 2 } };

beforeEach(() => {
  mockConfigureByContextProduct.mockReset();
});

describe("epConfigureBundle", () => {
  it("returns the configured bundle payload verbatim", async () => {
    const payload = {
      data: {
        id: "configured-1",
        meta: {
          bundle_configuration: { selected_options: SELECTED },
          display_price: { without_tax: { formatted: "$42.00" } },
        },
      },
      included: { main_images: [{ id: "img-1" }] },
    };
    mockConfigureByContextProduct.mockResolvedValue({ data: payload });

    const result = await withEpSession(SESSION, () =>
      epConfigureBundle({ bundleId: "b1", selectedOptions: SELECTED })
    );

    expect(result).toEqual(payload);
    expect(mockConfigureByContextProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { product_id: "b1" },
        body: { data: { selected_options: SELECTED } },
      })
    );
  });

  it("sends the selections as plain numbers", async () => {
    mockConfigureByContextProduct.mockResolvedValue({ data: {} });

    await withEpSession(SESSION, () =>
      epConfigureBundle({ bundleId: "b1", selectedOptions: SELECTED })
    );

    const { body } = mockConfigureByContextProduct.mock.calls[0][0];
    // The SDK types these as BigInt; the JSON serializer throws on one.
    expect(() => JSON.stringify(body)).not.toThrow();
  });

  it("throws when Elastic Path rejects the configuration", async () => {
    mockConfigureByContextProduct.mockResolvedValue({
      error: { errors: [{ detail: "invalid option" }] },
    });

    await expect(
      withEpSession(SESSION, () =>
        epConfigureBundle({ bundleId: "b1", selectedOptions: SELECTED })
      )
    ).rejects.toThrow(/invalid option/);
  });

  it("returns null without a bundle id", async () => {
    const result = await withEpSession(SESSION, () =>
      epConfigureBundle({ bundleId: "", selectedOptions: SELECTED })
    );
    expect(result).toBeNull();
    expect(mockConfigureByContextProduct).not.toHaveBeenCalled();
  });

  it("throws when called outside withEpSession", async () => {
    await expect(
      epConfigureBundle({ bundleId: "b1", selectedOptions: SELECTED })
    ).rejects.toThrow("no EP session");
  });
});
