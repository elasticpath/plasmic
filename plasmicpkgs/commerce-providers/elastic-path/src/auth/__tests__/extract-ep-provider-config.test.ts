import { extractEpProviderConfig } from "../extract-ep-provider-config";

// Minified snippet taken from a real Plasmic loader response for a project
// with the EP Provider configured: clientId set, host="custom", customHost set.
const EP_PROVIDER_MODULE_CUSTOM_HOST = `
function E(r){
  let e=$(),n=or(),{children:s,commerceProviderComponentProps:o,shopperContextProps:t}=r;
  return g.createElement(e,
    {...o,
      clientId:o&&"clientId"in o?o.clientId:"oVC2dwzwVi0sCbov7voN63H8gami9do0TLm3GaVKAJ",
      customHost:o&&"customHost"in o?o.customHost:"https://epcc-integration.global.ssl.fastly.net",
      host:o&&"host"in o?o.host:"custom",
      locale:o&&"locale"in o?o.locale:"en-US",
      serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!0,
      serverToken:o&&"serverToken"in o?o.serverToken:void 0
    },
    g.createElement(n,{...t,
      accountId:t&&"accountId"in t?t.accountId:void 0,
      cartId:t&&"cartId"in t?t.cartId:void 0,
      currency:t&&"currency"in t?t.currency:void 0,
      locale:t&&"locale"in t?t.locale:void 0
    },s));
}
`;

const EP_PROVIDER_MODULE_PREDEFINED_HOST = `
function E(r){
  let e=$(),n=or(),{children:s,commerceProviderComponentProps:o,shopperContextProps:t}=r;
  return g.createElement(e, {
    clientId:o&&"clientId"in o?o.clientId:"abc123",
    host:o&&"host"in o?o.host:"https://useast.api.elasticpath.com",
    serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!1
  });
}
`;

describe("extractEpProviderConfig", () => {
  it("returns null for empty / missing prefetchedData", () => {
    expect(extractEpProviderConfig(null)).toBeNull();
    expect(extractEpProviderConfig(undefined)).toBeNull();
    expect(extractEpProviderConfig({} as any)).toBeNull();
    expect(
      extractEpProviderConfig({ bundle: { modules: { server: [] } } } as any)
    ).toBeNull();
  });

  it("extracts clientId + customHost when host === 'custom'", () => {
    const config = extractEpProviderConfig({
      bundle: {
        projects: [{ globalContextsProviderFileName: "global__proj.js" }],
        modules: {
          server: [
            {
              type: "code",
              fileName: "global__proj.js",
              code: EP_PROVIDER_MODULE_CUSTOM_HOST,
            },
          ],
        },
      },
    });
    expect(config).toEqual({
      clientId: "oVC2dwzwVi0sCbov7voN63H8gami9do0TLm3GaVKAJ",
      host: "https://epcc-integration.global.ssl.fastly.net",
      serverCartMode: true,
    });
  });

  it("uses predefined host value directly when host !== 'custom'", () => {
    const config = extractEpProviderConfig({
      bundle: {
        projects: [{ globalContextsProviderFileName: "global__proj.js" }],
        modules: {
          server: [
            {
              type: "code",
              fileName: "global__proj.js",
              code: EP_PROVIDER_MODULE_PREDEFINED_HOST,
            },
          ],
        },
      },
    });
    expect(config).toEqual({
      clientId: "abc123",
      host: "https://useast.api.elasticpath.com",
      serverCartMode: false,
    });
  });

  it("falls back to non-project modules when no project globalContexts file matches", () => {
    const config = extractEpProviderConfig({
      bundle: {
        projects: [],
        modules: {
          server: [
            {
              type: "code",
              fileName: "some-other.js",
              code: EP_PROVIDER_MODULE_CUSTOM_HOST,
            },
          ],
        },
      },
    });
    expect(config?.clientId).toBe("oVC2dwzwVi0sCbov7voN63H8gami9do0TLm3GaVKAJ");
  });

  describe("host allowlist", () => {
    const smcModule = EP_PROVIDER_MODULE_CUSTOM_HOST.replace(
      "https://epcc-integration.global.ssl.fastly.net",
      "https://commerce.selfmanaged.example"
    );
    const bundleWith = (code: string) => ({
      bundle: {
        projects: [{ globalContextsProviderFileName: "global__proj.js" }],
        modules: {
          server: [{ type: "code", fileName: "global__proj.js", code }],
        },
      },
    });

    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it("accepts the Elastic Path regions and the integration host by default", () => {
      expect(
        extractEpProviderConfig(bundleWith(EP_PROVIDER_MODULE_PREDEFINED_HOST))
          ?.host
      ).toBe("https://useast.api.elasticpath.com");
      expect(
        extractEpProviderConfig(bundleWith(EP_PROVIDER_MODULE_CUSTOM_HOST))?.host
      ).toBe("https://epcc-integration.global.ssl.fastly.net");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("rejects an unlisted host and says so, naming the host and the option", () => {
      expect(extractEpProviderConfig(bundleWith(smcModule))).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("commerce.selfmanaged.example")
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("hostAllowlist")
      );
    });

    it("accepts a Self Managed Commerce host once it is allowlisted", () => {
      expect(
        extractEpProviderConfig(bundleWith(smcModule), {
          hostAllowlist: ["commerce.selfmanaged.example"],
        })?.host
      ).toBe("https://commerce.selfmanaged.example");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("honours wildcard entries", () => {
      expect(
        extractEpProviderConfig(bundleWith(smcModule), {
          hostAllowlist: ["*.selfmanaged.example"],
        })?.host
      ).toBe("https://commerce.selfmanaged.example");
    });

    it("logs rather than silently returning null when nothing matches the regex", () => {
      expect(
        extractEpProviderConfig(bundleWith("function noop(){}"))
      ).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("no usable EP Provider config")
      );
    });
  });

  it("returns null when clientId is an empty string (EP Provider not configured)", () => {
    const unconfigured = `
      function E(r){
        return g.createElement(e, {
          clientId:o&&"clientId"in o?o.clientId:"",
          host:o&&"host"in o?o.host:"https://euwest.api.elasticpath.com"
        });
      }
    `;
    expect(
      extractEpProviderConfig({
        bundle: {
          projects: [{ globalContextsProviderFileName: "global__proj.js" }],
          modules: {
            server: [
              {
                type: "code",
                fileName: "global__proj.js",
                code: unconfigured,
              },
            ],
          },
        },
      })
    ).toBeNull();
  });
});
