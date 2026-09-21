/**
 * The account-management header is attached in one place — the server
 * client builder — so every `ep.*` function carries the selected
 * organisation's credential without any function opting in.
 */
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
