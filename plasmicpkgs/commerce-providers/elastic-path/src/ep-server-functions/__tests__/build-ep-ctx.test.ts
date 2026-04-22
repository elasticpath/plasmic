// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildEpCtx } = require("../build-ep-ctx");

const EP_PROVIDER_MODULE = `
function E(r){
  return g.createElement(e, {
    clientId:o&&"clientId"in o?o.clientId:"cid-abc",
    customHost:o&&"customHost"in o?o.customHost:"https://custom.ep.com",
    host:o&&"host"in o?o.host:"custom",
    serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!0
  });
}
`;

const makePrefetchedData = () => ({
  bundle: {
    projects: [{ globalContextsProviderFileName: "global__p.js" }],
    modules: {
      server: [
        { type: "code", fileName: "global__p.js", code: EP_PROVIDER_MODULE },
      ],
    },
  },
});

describe("buildEpCtx", () => {
  it("returns clientId, host, and serverCartMode resolved from the Plasmic bundle", () => {
    const ctx = buildEpCtx(makePrefetchedData(), {
      session: { accessToken: "tok-abc" },
    });

    expect(ctx).toEqual(
      expect.objectContaining({
        clientId: "cid-abc",
        host: "https://custom.ep.com",
        serverCartMode: true,
        accessToken: "tok-abc",
      })
    );
  });

  it("produces an anonymous ctx (empty accessToken, no cartId/accountId) when the session is empty", () => {
    const ctx = buildEpCtx(makePrefetchedData(), { session: {} });

    expect(ctx.accessToken).toBe("");
    expect(ctx.cartId).toBeUndefined();
    expect(ctx.accountId).toBeUndefined();
    expect(ctx.clientId).toBe("cid-abc");
    expect(ctx.host).toBe("https://custom.ep.com");
  });

  it("throws a clear error when prefetchedData has no EP Provider config", () => {
    expect(() =>
      buildEpCtx(
        { bundle: { projects: [], modules: { server: [] } } },
        { session: { accessToken: "tok" } }
      )
    ).toThrow(/EP Provider config not found/);
  });
});
