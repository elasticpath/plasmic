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

  it("prefers EP customHost when CMS/Strapi host defaults appear first in the same module", () => {
    // Mirrors Studio codegen: one global__*.js nests CMS + Strapi + EP.
    const sharedGlobalContexts = `
function E(r){
  let e=$(),cms=Cms(),strapi=St(),ep=Ep(),
    {children:s,cmsProps:l,strapiProps:m,commerceProviderComponentProps:o}=r;
  return g.createElement(cms,{
    databaseId:l&&"databaseId"in l?l.databaseId:void 0,
    host:l&&"host"in l?l.host:"https://data.plasmic.app"
  },g.createElement(strapi,{
    host:m&&"host"in m?m.host:"https://graceful-belief.strapiapp.com/"
  },g.createElement(ep,{
    clientId:o&&"clientId"in o?o.clientId:"b6ratpsgidekICtcXjPWPODbGHckKfXWNNXnTivqQR",
    customHost:o&&"customHost"in o?o.customHost:"https://epcc-integration.global.ssl.fastly.net",
    host:o&&"host"in o?o.host:"custom",
    serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!0
  },s)));
}
`;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(
        extractEpProviderConfig({
          bundle: {
            projects: [{ globalContextsProviderFileName: "global__proj.js" }],
            modules: {
              server: [
                {
                  type: "code",
                  fileName: "global__proj.js",
                  code: sharedGlobalContexts,
                },
              ],
            },
          },
        })
      ).toEqual({
        clientId: "b6ratpsgidekICtcXjPWPODbGHckKfXWNNXnTivqQR",
        host: "https://epcc-integration.global.ssl.fastly.net",
      });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  describe("props are scoped to one provider", () => {
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

    it("does not adopt a neighbour's host when EP is Custom with customHost blank", () => {
      // customHost is a hidden prop — selecting Custom and not typing a URL is
      // an easy mistake, and localhost is allowlisted outside production.
      const blankCustomHost = `
function E(r){
  let {children:s,strapiProps:m,commerceProviderComponentProps:o}=r;
  return g.createElement(strapi,{
    host:m&&"host"in m?m.host:"http://localhost:1337"
  },g.createElement(ep,{
    clientId:o&&"clientId"in o?o.clientId:"EP_REAL_CLIENT_ID",
    customHost:o&&"customHost"in o?o.customHost:"",
    host:o&&"host"in o?o.host:"custom"
  },s));
}
`;
      expect(extractEpProviderConfig(bundleWith(blankCustomHost))).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("no usable EP Provider config")
      );
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("localhost:1337")
      );
    });

    it("keeps EP's region host when another provider is the one set to Custom", () => {
      const foreignCustom = `
function E(r){
  let {children:s,commerceProviderComponentProps:o,otherProps:p}=r;
  return g.createElement(ep,{
    clientId:o&&"clientId"in o?o.clientId:"EP_REAL_CLIENT_ID",
    host:o&&"host"in o?o.host:"https://useast.api.elasticpath.com",
    serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!0
  },g.createElement(other,{
    customHost:p&&"customHost"in p?p.customHost:"https://someone-elses.example.com",
    host:p&&"host"in p?p.host:"custom"
  },s));
}
`;
      expect(extractEpProviderConfig(bundleWith(foreignCustom))).toEqual({
        clientId: "EP_REAL_CLIENT_ID",
        host: "https://useast.api.elasticpath.com",
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("does not pair another provider's clientId with EP's host", () => {
      const foreignClientIdFirst = `
function E(r){
  let {children:s,ctProps:c,commerceProviderComponentProps:o}=r;
  return g.createElement(commercetools,{
    clientId:c&&"clientId"in c?c.clientId:"FOREIGN_CLIENT_ID",
    host:c&&"host"in c?c.host:"https://api.europe-west1.gcp.commercetools.com"
  },g.createElement(ep,{
    clientId:o&&"clientId"in o?o.clientId:"EP_REAL_CLIENT_ID",
    customHost:o&&"customHost"in o?o.customHost:"https://epcc-integration.global.ssl.fastly.net",
    host:o&&"host"in o?o.host:"custom",
    serverCartMode:o&&"serverCartMode"in o?o.serverCartMode:!0
  },s));
}
`;
      expect(extractEpProviderConfig(bundleWith(foreignClientIdFirst))).toEqual({
        clientId: "EP_REAL_CLIENT_ID",
        host: "https://epcc-integration.global.ssl.fastly.net",
      });
      // The commercetools host is rejected on the way past, but the storefront
      // works, so the operator must not be told anything is wrong.
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("names the provider's own host when its host is rejected", () => {
      // The rejection message tells the operator to allowlist the host it
      // names, so naming a neighbour's host talks them into pointing the
      // storefront at that neighbour.
      const cmsFirstUnlisted = `
function E(r){
  let {children:s,cmsProps:l,commerceProviderComponentProps:o}=r;
  return g.createElement(cms,{
    host:l&&"host"in l?l.host:"https://data.plasmic.app"
  },g.createElement(ep,{
    clientId:o&&"clientId"in o?o.clientId:"EP_REAL_CLIENT_ID",
    host:o&&"host"in o?o.host:"https://commerce.selfmanaged.example"
  },s));
}
`;
      expect(extractEpProviderConfig(bundleWith(cmsFirstUnlisted))).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("commerce.selfmanaged.example")
      );
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("data.plasmic.app")
      );
    });
  });
});
