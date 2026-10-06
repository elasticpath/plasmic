import { getACart } from "@epcc-sdk/sdks-shopper";
import { buildFixedTokenEpClient } from "../fixed-token-ep-client";

const OPAQUE_TOKEN = "a550d8cbd4a4627013452359ab69694cd446615a";

async function requestsSentFor(token: string): Promise<Request[]> {
  const sent: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push(request);
      const body = request.url.includes("/oauth/")
        ? {
            access_token: "minted",
            expires: Math.floor(Date.now() / 1000) + 3600,
          }
        : { data: { id: "cart-1" } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  ) as typeof fetch;
  try {
    await getACart({
      client: buildFixedTokenEpClient({
        host: "https://api.test.elasticpath.com",
        clientId: "test-client-id",
        token,
      }),
      path: { cartID: "cart-1" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return sent;
}

describe("buildFixedTokenEpClient", () => {
  it("sends an opaque Elastic Path token as it is", async () => {
    const sent = await requestsSentFor(OPAQUE_TOKEN);

    expect(sent.map((r) => r.url)).toEqual([
      "https://api.test.elasticpath.com/v2/carts/cart-1",
    ]);
    expect(sent[0].headers.get("Authorization")).toBe(
      `Bearer ${OPAQUE_TOKEN}`
    );
  });

  it("mints an implicit token when it holds none", async () => {
    const sent = await requestsSentFor("");

    expect(sent.map((r) => new URL(r.url).pathname)).toEqual([
      "/oauth/access_token",
      "/v2/carts/cart-1",
    ]);
    expect(sent[1].headers.get("Authorization")).toBe("Bearer minted");
  });
});
