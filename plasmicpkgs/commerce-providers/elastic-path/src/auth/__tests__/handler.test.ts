import { createEpAuth } from "../create-ep-auth";
import { toNextJsHandler } from "../handler";
import { EpTokenData } from "../cookies";

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

const validTokenData: EpTokenData = {
  accessToken: "existing-token",
  expires: Math.floor(Date.now() / 1000) + 3600,
  expiresIn: 3600,
  tokenType: "Bearer",
  clientId: "my-client-id",
  host: "https://useast.api.elasticpath.com",
};

function encode(data: any): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

function makeEpAuth(basePath?: string, cartMergeStrategy?: "merge" | "replace" | "prompt") {
  return createEpAuth({
    clientId: "my-client-id",
    host: "https://useast.api.elasticpath.com",
    basePath,
    cartMergeStrategy,
  });
}

function makeRequest(
  method: string,
  path: string,
  body?: any,
  cookies?: Record<string, string>
): { method: string; url: string; cookies: Record<string, string>; json: () => Promise<any> } {
  return {
    method,
    url: `http://localhost:3000${path}`,
    cookies: cookies ?? { ep_token: encode(validTokenData) },
    json: () => Promise.resolve(body ?? {}),
  };
}

describe("toNextJsHandler", () => {
  it("returns GET, POST, PATCH, DELETE handlers", () => {
    const handler = toNextJsHandler(makeEpAuth());
    expect(typeof handler.GET).toBe("function");
    expect(typeof handler.POST).toBe("function");
    expect(typeof handler.PATCH).toBe("function");
    expect(typeof handler.DELETE).toBe("function");
  });
});

describe("route matching", () => {
  it("returns 404 for unknown paths", async () => {
    const handler = toNextJsHandler(makeEpAuth());
    const res = await handler.GET(makeRequest("GET", "/api/ep/unknown") as any);
    expect(res.status).toBe(404);
  });

  it("routes GET /api/ep/cart to cart handler", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], meta: {} }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest("GET", "/api/ep/cart", undefined, {
      ep_token: encode(validTokenData),
      ep_cart: "cart-123",
    });
    const res = await handler.GET(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accountStatus).toBeDefined();
  });
});

describe("cart GET", () => {
  it("calls EP API with Authorization header from session", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "item-1" }], meta: {} }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest("GET", "/api/ep/cart", undefined, {
      ep_token: encode(validTokenData),
      ep_cart: "cart-123",
    });
    const res = await handler.GET(req as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/v2/carts/cart-123");
    expect(opts.headers["Authorization"]).toBe("Bearer existing-token");

    const json = await res.json();
    expect(json.accountStatus).toBe("anonymous");
  });
});

describe("cart POST (add item)", () => {
  it("calls EP API to add item and returns cart data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: [{ id: "item-1", quantity: 1 }], meta: {} }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/cart/items",
      { productId: "prod-1", quantity: 1 },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/v2/carts/cart-123/items");
    expect(opts.method).toBe("POST");
  });
});

describe("cart PATCH (update item)", () => {
  it("routes to correct EP endpoint with item ID", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "item-1", quantity: 3 } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "PATCH",
      "/api/ep/cart/items/item-1",
      { quantity: 3 },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.PATCH(req as any);

    expect(res.status).toBe(200);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/v2/carts/cart-123/items/item-1");
    expect(opts.method).toBe("PUT");
  });
});

describe("cart DELETE (remove item)", () => {
  it("routes to correct EP endpoint with item ID", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "DELETE",
      "/api/ep/cart/items/item-1",
      undefined,
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.DELETE(req as any);

    expect(res.status).toBe(200);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/v2/carts/cart-123/items/item-1");
    expect(opts.method).toBe("DELETE");
  });
});

describe("checkout routes", () => {
  it("routes POST /api/ep/checkout/sessions to create session", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { id: "session-1", status: "open" } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/checkout/sessions",
      { cartId: "cart-123" },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accountStatus).toBe("anonymous");
  });

  it("routes POST /api/ep/checkout/sessions/pay", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { status: "processing" } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/checkout/sessions/pay",
      { paymentMethod: "stripe" },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accountStatus).toBeDefined();
  });

  it("routes POST /api/ep/checkout/sessions/confirm", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { status: "complete" } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/checkout/sessions/confirm",
      {},
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
  });

  it("routes POST /api/ep/checkout/sessions/shipping", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { rates: [] } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/checkout/sessions/shipping",
      { address: {} },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
  });

  it("routes PATCH /api/ep/checkout/sessions/current", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ data: { status: "open" } }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "PATCH",
      "/api/ep/checkout/sessions/current",
      { customerInfo: { name: "Test", email: "test@test.com" } },
      { ep_token: encode(validTokenData), ep_cart: "cart-123" }
    );
    const res = await handler.PATCH(req as any);

    expect(res.status).toBe(200);
  });
});

describe("account auth routes", () => {
  it("routes POST /api/ep/account/login", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              account_id: "acc-1",
              account_name: "Acme",
              account_member_id: "mem-1",
              token: "account-token",
              expires: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/account/login",
      { username: "user@test.com", password: "pass", passwordProfileId: "pp-1" },
      { ep_token: encode(validTokenData) }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accountStatus).toBeDefined();
  });

  it("routes POST /api/ep/account/select", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/account/select",
      {
        accountId: "acc-1",
        accountName: "Acme",
        accountMemberId: "mem-1",
        token: "account-token",
        expires: Math.floor(Date.now() / 1000) + 86400,
      },
      { ep_token: encode(validTokenData) }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    // Should set ep_account cookie
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const allHeaders: string[] = [];
    res.headers.forEach((v, k) => {
      if (k === "set-cookie") allHeaders.push(v);
    });
    const hasAccountCookie = allHeaders.some((c) => c.includes("ep_account="));
    expect(hasAccountCookie).toBe(true);
  });

  it("merges anonymous cart on login (merge strategy)", async () => {
    // First call: login endpoint; second call: cart association
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Login response — single account
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  account_id: "acc-1",
                  account_name: "Acme",
                  account_member_id: "mem-1",
                  token: "account-token",
                  expires: Math.floor(Date.now() / 1000) + 86400,
                },
              ],
            }),
        });
      }
      // Cart association call
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: {} }),
      });
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/account/login",
      { username: "user@test.com", password: "pass", passwordProfileId: "pp-1" },
      { ep_token: encode(validTokenData), ep_cart: "anon-cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    // Should have made the cart association call
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    const assocCall = mockFetch.mock.calls[1];
    expect(assocCall[0]).toContain("/v2/carts/anon-cart-123/relationships/accounts");
  });

  it("replaces anonymous cart on login (replace strategy)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              account_id: "acc-1",
              account_name: "Acme",
              account_member_id: "mem-1",
              token: "account-token",
              expires: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        }),
    });

    const handler = toNextJsHandler(makeEpAuth(undefined, "replace"));
    const req = makeRequest(
      "POST",
      "/api/ep/account/login",
      { username: "user@test.com", password: "pass", passwordProfileId: "pp-1" },
      { ep_token: encode(validTokenData), ep_cart: "anon-cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    // Should clear the ep_cart cookie
    const allHeaders: string[] = [];
    res.headers.forEach((v, k) => {
      if (k === "set-cookie") allHeaders.push(v);
    });
    const clearCart = allHeaders.find((c) => c.includes("ep_cart="));
    expect(clearCart).toContain("Max-Age=0");
  });

  it("returns anonymous cart in response (prompt strategy)", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  account_id: "acc-1",
                  account_name: "Acme",
                  account_member_id: "mem-1",
                  token: "account-token",
                  expires: Math.floor(Date.now() / 1000) + 86400,
                },
              ],
            }),
        });
      }
      // Cart fetch for prompt
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ id: "item-1", quantity: 2 }] }),
      });
    });

    const handler = toNextJsHandler(makeEpAuth(undefined, "prompt"));
    const req = makeRequest(
      "POST",
      "/api/ep/account/login",
      { username: "user@test.com", password: "pass", passwordProfileId: "pp-1" },
      { ep_token: encode(validTokenData), ep_cart: "anon-cart-123" }
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.anonymousCart).toBeDefined();
    expect(json.anonymousCart.data).toHaveLength(1);
  });

  it("skips merge when no anonymous cart", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              account_id: "acc-1",
              account_name: "Acme",
              account_member_id: "mem-1",
              token: "account-token",
              expires: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        }),
    });

    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "POST",
      "/api/ep/account/login",
      { username: "user@test.com", password: "pass", passwordProfileId: "pp-1" },
      { ep_token: encode(validTokenData) }  // no ep_cart
    );
    const res = await handler.POST(req as any);

    expect(res.status).toBe(200);
    // Only the login call, no cart association
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("routes DELETE /api/ep/account/logout", async () => {
    const handler = toNextJsHandler(makeEpAuth());
    const req = makeRequest(
      "DELETE",
      "/api/ep/account/logout",
      undefined,
      { ep_token: encode(validTokenData) }
    );
    const res = await handler.DELETE(req as any);

    expect(res.status).toBe(200);
    // Should clear ep_account cookie (Max-Age=0)
    const allHeaders: string[] = [];
    res.headers.forEach((v, k) => {
      if (k === "set-cookie") allHeaders.push(v);
    });
    const clearCookie = allHeaders.find((c) => c.includes("ep_account="));
    expect(clearCookie).toContain("Max-Age=0");
  });
});

describe("custom basePath", () => {
  it("routes using custom basePath", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [], meta: {} }),
    });

    const handler = toNextJsHandler(makeEpAuth("/api/store"));
    const req = makeRequest("GET", "/api/store/cart", undefined, {
      ep_token: encode(validTokenData),
      ep_cart: "cart-123",
    });
    const res = await handler.GET(req as any);
    expect(res.status).toBe(200);
  });

  it("returns 404 when path does not match custom basePath", async () => {
    const handler = toNextJsHandler(makeEpAuth("/api/store"));
    const res = await handler.GET(
      makeRequest("GET", "/api/ep/cart") as any
    );
    expect(res.status).toBe(404);
  });
});
