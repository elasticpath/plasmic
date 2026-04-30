import initElasticPathClient from "../../client";

describe("initElasticPathClient", () => {
  it("returns a client given just credentials", () => {
    const client = initElasticPathClient({
      clientId: "cid",
      host: "https://useast.api.elasticpath.com",
    });
    expect(client).toBeDefined();
    expect(typeof client.interceptors).toBe("object");
  });
});
