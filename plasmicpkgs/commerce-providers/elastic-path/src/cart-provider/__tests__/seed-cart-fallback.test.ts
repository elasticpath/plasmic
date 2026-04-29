const mockEpGetCart = jest.fn();

jest.mock("../../ep-server-functions", () => ({
  epGetCart: (...args: unknown[]) => mockEpGetCart(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedCartFallback } = require("../seed-cart-fallback");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epCartCacheKey } = require("../cache-keys");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { unstable_serialize } = require("swr");

beforeEach(() => {
  mockEpGetCart.mockReset();
});

describe("seedCartFallback", () => {
  it("returns the serialized-cache-key → cart map when a cart is on the session", async () => {
    const cart = { id: "cart-1", lineItems: [{ id: "i" }] };
    mockEpGetCart.mockResolvedValue(cart);

    const fallback = await seedCartFallback();

    const expectedKey = unstable_serialize(epCartCacheKey());
    expect(fallback[expectedKey]).toEqual(cart);
  });

  it("returns null under the same shared key when there is no cart yet", async () => {
    mockEpGetCart.mockResolvedValue(null);

    const fallback = await seedCartFallback();

    const expectedKey = unstable_serialize(epCartCacheKey());
    expect(fallback[expectedKey]).toBeNull();
  });

  it("never throws — returns null under the shared key when epGetCart fails", async () => {
    mockEpGetCart.mockRejectedValue(new Error("EP unreachable"));

    await expect(seedCartFallback()).resolves.toBeDefined();
    const fallback = await seedCartFallback();
    const expectedKey = unstable_serialize(epCartCacheKey());
    expect(fallback[expectedKey]).toBeNull();
  });
});
