import { getACart } from "@epcc-sdk/sdks-shopper";
import { EP_ACCOUNT_TOKEN_HEADER } from "../../../auth/ep-plugin/envelope";
import { buildShopperEpClient } from "../shopper-client";
import type { SessionHandlerContext } from "../types";

function ctxWith(
  overrides: Partial<SessionHandlerContext> = {}
): SessionHandlerContext {
  return {
    epCredentials: {
      clientId: "test-client-id",
      apiBaseUrl: "https://api.test.elasticpath.com",
    },
    adapterRegistry: { register: jest.fn(), getAdapter: jest.fn() },
    sessionStore: { get: jest.fn(), set: jest.fn(), delete: jest.fn() },
    shopperAccessToken: "shopper-token",
    ...overrides,
  };
}

async function requestsSentFor(ctx: SessionHandlerContext): Promise<Request[]> {
  const sent: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    sent.push(request);
    const body = request.url.includes("/oauth/")
      ? { access_token: "minted", expires: Math.floor(Date.now() / 1000) + 3600 }
      : { data: { id: "cart-1" } };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await getACart({
      client: buildShopperEpClient(ctx),
      path: { cartID: "cart-1" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return sent;
}

async function cartReadHeadersFor(ctx: SessionHandlerContext) {
  const cartReads = (await requestsSentFor(ctx)).filter((r) =>
    r.url.endsWith("/v2/carts/cart-1")
  );
  expect(cartReads).toHaveLength(1);
  return cartReads[0].headers;
}

describe("buildShopperEpClient", () => {
  it("sends the selected account's credential", async () => {
    const headers = await cartReadHeadersFor(
      ctxWith({ accountToken: "account-management-token" })
    );

    expect(headers.get(EP_ACCOUNT_TOKEN_HEADER)).toBe(
      "account-management-token"
    );
  });

  it("sends no account credential when no account is selected", async () => {
    const headers = await cartReadHeadersFor(ctxWith());

    expect(headers.has(EP_ACCOUNT_TOKEN_HEADER)).toBe(false);
  });

  it("keeps the account credential off the token endpoint", async () => {
    const sent = await requestsSentFor(
      ctxWith({ accountToken: "account-management-token" })
    );

    for (const request of sent.filter((r) => r.url.includes("/oauth/"))) {
      expect(request.headers.has(EP_ACCOUNT_TOKEN_HEADER)).toBe(false);
    }
  });
});
