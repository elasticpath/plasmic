const interceptors: Array<
  (request: Request, options: unknown) => Promise<Request>
> = [];

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: () => ({
    client: {
      interceptors: {
        request: {
          use: (fn: (request: Request, options: unknown) => Promise<Request>) =>
            interceptors.push(fn),
        },
      },
    },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildEpClient } = require("../ep-client");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EP_ACCOUNT_TOKEN_HEADER } = require("../../auth/ep-plugin/envelope");

const BASE_AUTH = {
  accessToken: "shopper-token",
  host: "https://api.test.elasticpath.com",
  clientId: "cid-abc",
};

async function headersFor(auth: Record<string, unknown>) {
  interceptors.length = 0;
  buildEpClient(auth as any);
  let request = new Request("https://api.test.elasticpath.com/v2/products");
  for (const intercept of interceptors) {
    request = await intercept(request, {});
  }
  return request.headers;
}

describe("buildEpClient", () => {
  it("asks for multi-location inventory on every call, as the browser client does", async () => {
    // Not scoped to the inventory functions on purpose: the locations endpoint
    // 404s without this header and stock loses its per-location breakdown, and
    // both read as "this store has none" rather than as an error. Leaving it to
    // each function to remember is how epGetLocations shipped returning [] for
    // a store with five locations.
    const headers = await headersFor(BASE_AUTH);
    expect(headers.get("EP-Inventories-Multi-Location")).toBe("true");
  });

  it("carries the selected organisation's credential on every call", async () => {
    const headers = await headersFor({
      ...BASE_AUTH,
      accountToken: "account-management-token",
    });

    expect(headers.get(EP_ACCOUNT_TOKEN_HEADER)).toBe(
      "account-management-token"
    );
  });

  it("sends no account header when no organisation is selected", async () => {
    const headers = await headersFor(BASE_AUTH);

    expect(headers.has(EP_ACCOUNT_TOKEN_HEADER)).toBe(false);
  });
});
