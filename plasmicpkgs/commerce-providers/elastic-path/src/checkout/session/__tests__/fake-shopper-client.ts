type Intercept = (request: Request) => Request | Promise<Request>;

export interface FakeShopperClient {
  token: string;
  intercepts: Intercept[];
}

export function fakeShopperClient(
  _config: unknown,
  opts?: { storage?: { get?: () => string } }
) {
  const intercepts: Intercept[] = [];
  return {
    client: {
      token: opts?.storage?.get?.() ?? "",
      intercepts,
      interceptors: {
        request: { use: (fn: Intercept) => intercepts.push(fn) },
      },
    },
  };
}

export async function headersSentBy(
  client: FakeShopperClient
): Promise<Headers> {
  let request = new Request("https://api.test.com/v2/carts/cart-1");
  for (const intercept of client.intercepts) {
    request = await intercept(request);
  }
  return request.headers;
}
