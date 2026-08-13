// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildEpCtx } = require("../build-ep-ctx");

const EP_PROVIDER_MODULE = `
function E(r){
  return g.createElement(e, {
    clientId:o&&"clientId"in o?o.clientId:"cid-abc",
    customHost:o&&"customHost"in o?o.customHost:"https://epcc-integration.global.ssl.fastly.net",
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
  it("returns clientId and host resolved from the Plasmic bundle", () => {
    const ctx = buildEpCtx(makePrefetchedData(), {
      session: { accessToken: "tok-abc" },
    });

    expect(ctx).toEqual(
      expect.objectContaining({
        clientId: "cid-abc",
        host: "https://epcc-integration.global.ssl.fastly.net",
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
    expect(ctx.host).toBe("https://epcc-integration.global.ssl.fastly.net");
  });

  it("rejects a host outside the allowlist, and accepts it once the deployment opts in", () => {
    const smcData = {
      bundle: {
        projects: [{ globalContextsProviderFileName: "global__p.js" }],
        modules: {
          server: [
            {
              type: "code",
              fileName: "global__p.js",
              code: EP_PROVIDER_MODULE.replace(
                "https://epcc-integration.global.ssl.fastly.net",
                "https://commerce.selfmanaged.example"
              ),
            },
          ],
        },
      },
    };
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() =>
      buildEpCtx(smcData, { session: { accessToken: "tok" } })
    ).toThrow(/EP Provider config not found/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("commerce.selfmanaged.example")
    );

    const ctx = buildEpCtx(smcData, {
      session: { accessToken: "tok" },
      hostAllowlist: ["commerce.selfmanaged.example"],
    });
    expect(ctx.host).toBe("https://commerce.selfmanaged.example");

    errorSpy.mockRestore();
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
