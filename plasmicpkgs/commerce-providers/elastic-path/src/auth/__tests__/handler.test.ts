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

function makeEpAuth(basePath?: string) {
  return createEpAuth({
    clientId: "my-client-id",
    host: "https://useast.api.elasticpath.com",
    basePath,
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
