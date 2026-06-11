jest.mock("@epcc-sdk/sdks-shopper", () => ({
  getByContextAllProducts: jest.fn(),
  createShopperClient: jest.fn(() => ({ client: {} })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const epSdk = require("@epcc-sdk/sdks-shopper") as {
  getByContextAllProducts: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveRequiresShipping, cartHasPhysicalItem } = require("../cart-shipping") as {
  resolveRequiresShipping: typeof import("../cart-shipping").resolveRequiresShipping;
  cartHasPhysicalItem: typeof import("../cart-shipping").cartHasPhysicalItem;
};

function productsResponse(commodityTypes: string[]) {
  return {
    data: {
      data: commodityTypes.map((commodity_type, i) => ({
        id: `prod-${i}`,
        attributes: { commodity_type },
      })),
    },
  };
}

const LOOKUP = {
  host: "https://api.test.com",
  clientId: "test-id",
  shopperAccessToken: "shopper-token",
};

beforeEach(() => jest.clearAllMocks());

describe("resolveRequiresShipping", () => {
  // The client flag may only ADD a shipping requirement, never suppress one a
  // physical cart imposes. requiresShipping defaults to true.
  it("requires shipping when the cart has a physical item, even if the client suppressed it", () => {
    expect(resolveRequiresShipping(false, true)).toBe(true);
  });

  it("honours client suppression only for a non-physical cart", () => {
    expect(resolveRequiresShipping(false, false)).toBe(false);
  });

  it("defaults to requiring shipping when the client flag is undefined", () => {
    expect(resolveRequiresShipping(undefined, false)).toBe(true);
    expect(resolveRequiresShipping(undefined, true)).toBe(true);
  });

  it("requires shipping when the client flag is true", () => {
    expect(resolveRequiresShipping(true, false)).toBe(true);
    expect(resolveRequiresShipping(true, true)).toBe(true);
  });
});

describe("cartHasPhysicalItem", () => {
  it("returns true when any product is a physical commodity", async () => {
    epSdk.getByContextAllProducts.mockResolvedValue(
      productsResponse(["digital", "physical"])
    );
    expect(
      await cartHasPhysicalItem({ ...LOOKUP, productIds: ["a", "b"] })
    ).toBe(true);
  });

  it("returns false when all products are digital", async () => {
    epSdk.getByContextAllProducts.mockResolvedValue(
      productsResponse(["digital", "digital"])
    );
    expect(
      await cartHasPhysicalItem({ ...LOOKUP, productIds: ["a", "b"] })
    ).toBe(false);
  });

  it("does not call EP and returns false for an empty product list", async () => {
    expect(await cartHasPhysicalItem({ ...LOOKUP, productIds: [] })).toBe(false);
    expect(epSdk.getByContextAllProducts).not.toHaveBeenCalled();
  });

  it("dedupes ids and queries with an in(id,...) filter", async () => {
    epSdk.getByContextAllProducts.mockResolvedValue(productsResponse(["digital"]));
    await cartHasPhysicalItem({ ...LOOKUP, productIds: ["a", "a", "b", ""] });
    const query = epSdk.getByContextAllProducts.mock.calls[0][0].query;
    expect(query.filter).toBe("in(id,a,b)");
  });

  it("fails open (returns false) and does not throw when the lookup errors", async () => {
    epSdk.getByContextAllProducts.mockRejectedValue(new Error("EP down"));
    expect(
      await cartHasPhysicalItem({ ...LOOKUP, productIds: ["a"] })
    ).toBe(false);
  });

  it("fails closed (returns true) when the lookup resolves fewer products than requested", async () => {
    // Healthy response, but one of the two requested products is missing — we
    // can't prove the cart is all-digital, so require shipping.
    epSdk.getByContextAllProducts.mockResolvedValue(productsResponse(["digital"]));
    expect(
      await cartHasPhysicalItem({ ...LOOKUP, productIds: ["a", "b"] })
    ).toBe(true);
  });
});
