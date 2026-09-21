/**
 * The cart routes reach Elastic Path through their own `callEp`, not
 * through `buildEpClient`, so the account-management header has to be
 * attached here too — otherwise a signed-in account member's cart reads
 * and writes stay list-priced while every `ep.*` call is account-scoped.
 */
import { createCartRoutes } from "../server-routes";
import { EP_ACCOUNT_TOKEN_HEADER } from "../../auth/ep-plugin/envelope";

const EP_HOST = "https://api.test.elasticpath.com";
const CART_ID = "63b53d4f-d88a-48b3-b416-8cb1470aad8d";

function buildRoutes(account: unknown) {
  const epAuth = {
    api: {
      getSession: jest.fn().mockResolvedValue({
        session: {
          accessToken: "shopper-token",
          host: EP_HOST,
          clientId: "cid",
          expires: Math.floor(Date.now() / 1000) + 3600,
          account,
        },
        cart: { id: CART_ID },
      }),
    },
    config: { trustedOrigins: ["http://localhost:3456"] },
  } as any;
  return createCartRoutes(epAuth);
}

/** Headers of the first Elastic Path request the routes made. */
async function epRequestHeaders(account: unknown) {
  const seen: Array<Record<string, string>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (_url: any, init: any) => {
    seen.push(init?.headers ?? {});
    return new Response(JSON.stringify({ data: {}, included: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  try {
    await buildRoutes(account).handle(
      new Request("http://localhost:3456/api/ep/cart", {
        method: "GET",
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
      { params: Promise.resolve({ path: [] }) }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  return seen[0] ?? {};
}

describe("createCartRoutes account scope", () => {
  it("carries the selected organisation's credential on the cart read", async () => {
    const headers = await epRequestHeaders({
      id: "acct-1",
      name: "Acme Industrial",
      token: "account-management-token",
      expires: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(headers[EP_ACCOUNT_TOKEN_HEADER]).toBe("account-management-token");
  });

  it("sends no account header when no organisation is selected", async () => {
    const headers = await epRequestHeaders(null);

    expect(EP_ACCOUNT_TOKEN_HEADER in headers).toBe(false);
  });
});
