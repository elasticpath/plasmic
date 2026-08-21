/** @jest-environment jsdom */

/**
 * `calculateShipping` promises something the platform cannot do.
 *
 * Elastic Path has no shopper-facing shipping-rates endpoint, and the route this
 * used to POST to — `/api/checkout/calculate-shipping` — is retired in this very
 * package and answers 410 Gone (#371/#374). So the call could only ever fail,
 * after a round trip, with a body nobody surfaced. It fails immediately, saying
 * what to do instead.
 */
jest.mock("../../../utils/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { renderHook, act } from "@testing-library/react";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useCheckout } = require("../use-checkout");

const ADDRESS = {
  first_name: "Ada",
  last_name: "Lovelace",
  line_1: "1 Main St",
  city: "Bristol",
  postcode: "BS1 1AA",
  country: "GB",
};

describe("useCheckout — calculateShipping", () => {
  let fetchSpy: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it("does not call the retired endpoint", async () => {
    const { result } = renderHook(() => useCheckout({ cartId: "cart-1" }));

    await act(async () => {
      await expect(
        result.current.calculateShipping(ADDRESS as any)
      ).rejects.toThrow();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says where rates actually come from", async () => {
    const { result } = renderHook(() => useCheckout({ cartId: "cart-1" }));

    await act(async () => {
      await expect(
        result.current.calculateShipping(ADDRESS as any)
      ).rejects.toThrow(/EP Checkout Session Provider/);
    });
  });

  it("leaves the hook usable, not stuck loading", async () => {
    const { result } = renderHook(() => useCheckout({ cartId: "cart-1" }));

    await act(async () => {
      await result.current.calculateShipping(ADDRESS as any).catch(() => undefined);
    });

    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.error).toBeInstanceOf(Error);
  });
});
