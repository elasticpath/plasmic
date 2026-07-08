/**
 * Legacy /checkout/calculate-shipping is RETIRED (#374 / #326).
 *
 * It previously fetched rates via the phantom `getShippingOptions`; the
 * composable checkout-session flow now sources rates from a server-side
 * resolver. This handler only guards the HTTP method and returns 410 Gone.
 */

jest.mock("../../../../utils/logger", () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock("../../../utils/api-helpers", () => ({
  createErrorResponse: jest.fn(
    (msg: string, code?: string, details?: any) => ({
      success: false,
      error: { message: msg, code, details },
    })
  ),
  validateMethod: jest.fn(
    (req: any, methods: string[]) => methods.includes(req.method)
  ),
}));

const calculateShippingHandler = require("../calculate-shipping").default;

function createMockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("legacy calculateShippingHandler (retired)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 410 Gone for a POST", async () => {
    const res = createMockRes();
    await calculateShippingHandler(
      { method: "POST", body: { cartId: "c1", shippingAddress: {} } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(410);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe("ENDPOINT_RETIRED");
  });

  it("returns 405 for a non-POST method", async () => {
    const res = createMockRes();
    await calculateShippingHandler({ method: "GET", body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("does not import a phantom SDK export (module loads cleanly)", () => {
    expect(typeof calculateShippingHandler).toBe("function");
  });
});
