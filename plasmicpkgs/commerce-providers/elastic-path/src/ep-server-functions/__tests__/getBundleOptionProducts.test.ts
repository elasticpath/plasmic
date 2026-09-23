const mockGetByContextAllProducts = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  getByContextAllProducts: (...args: unknown[]) =>
    mockGetByContextAllProducts(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epGetBundleOptionProducts } = require("../getBundleOptionProducts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

const mkProduct = (id: string) => ({
  id,
  type: "product",
  attributes: { name: `Name ${id}`, sku: `SKU-${id}` },
  relationships: { main_image: { data: { id: `img-${id}`, type: "main_image" } } },
  meta: {
    display_price: {
      without_tax: { amount: 1000, currency: "USD", formatted: "$10.00" },
    },
    product_types: [],
  },
});

const INCLUDED = {
  main_images: [
    { id: "img-p1", link: { href: "https://cdn.example/p1.jpg" } },
    { id: "img-p2", link: { href: "https://cdn.example/p2.jpg" } },
  ],
};

beforeEach(() => {
  mockGetByContextAllProducts.mockReset();
});

describe("epGetBundleOptionProducts", () => {
  it("returns the package's product shape, keyed by product id", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkProduct("p1"), mkProduct("p2")], included: INCLUDED },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ["p1", "p2"] })
    );

    expect(Object.keys(result)).toEqual(["p1", "p2"]);
    expect(result.p1.attributes.name).toBe("Name p1");
    expect(result.p1.attributes.sku).toBe("SKU-p1");
  });

  it("joins each option's image from the response's included block", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkProduct("p1")], included: INCLUDED },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ["p1"] })
    );

    expect(result.p1.images).toEqual([
      { url: "https://cdn.example/p1.jpg", alt: "Name p1" },
    ]);
  });

  it("publishes a price carrying all four members, not a bare string", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkProduct("p1")], included: INCLUDED },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ["p1"] })
    );

    expect(result.p1.meta.display_price.without_tax).toEqual({
      amount: 1000,
      currency: "USD",
      formatted: "$10.00",
      float_price: 10,
    });
  });

  it("asks for the images and a page large enough for the batch", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });

    await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ["p1", "p2"] })
    );

    expect(mockGetByContextAllProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          filter: "in(id,p1,p2)",
          include: ["main_image", "files"],
          "page[limit]": 2,
        }),
      })
    );
  });

  it("keeps the payload JSON-serializable", async () => {
    mockGetByContextAllProducts.mockResolvedValue({
      data: { data: [mkProduct("p1")], included: INCLUDED },
    });

    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ["p1"] })
    );

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("splits more than 100 ids across batches", async () => {
    mockGetByContextAllProducts.mockResolvedValue({ data: { data: [] } });
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);

    await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ids })
    );

    expect(mockGetByContextAllProducts).toHaveBeenCalledTimes(2);
  });

  it("keeps the products from batches that succeed when one fails", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `p${i}`);
    mockGetByContextAllProducts
      .mockResolvedValueOnce({ data: { data: [mkProduct("p1")] } })
      .mockRejectedValueOnce(new Error("boom"));

    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: ids })
    );

    expect(Object.keys(result)).toEqual(["p1"]);
  });

  it("returns an empty map for no product ids", async () => {
    const result = await withEpSession(SESSION, () =>
      epGetBundleOptionProducts({ productIds: [] })
    );
    expect(result).toEqual({});
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });

  it("returns an empty map when called outside withEpSession", async () => {
    const result = await epGetBundleOptionProducts({ productIds: ["p1"] });
    expect(result).toEqual({});
    expect(mockGetByContextAllProducts).not.toHaveBeenCalled();
  });
});
