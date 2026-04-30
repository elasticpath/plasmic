import initElasticPathClient from "../../client";

describe("initElasticPathClient", () => {
  it("returns a client given just credentials (anonymous-mint flow)", () => {
    // Post-#282: the client takes no pre-resolved token. The SDK mints
    // an anonymous token client-side on first use; shopper-bound calls
    // go through the proxy route and never touch this client.
    const client = initElasticPathClient({
      clientId: "cid",
      host: "https://useast.api.elasticpath.com",
    });
    expect(client).toBeDefined();
    expect(typeof client.interceptors).toBe("object");
  });
});
