import {
  epClientConfig,
  epRequestPort,
  makeRequestPort,
  memoryTokenStore,
} from "./client";

describe("epRequestPort", () => {
  // Exercises the real SDK client factory with our configuration: the shopper
  // SDK validates its options on construction, so a wrongly shaped or renamed
  // option fails here rather than on a designer's first query.
  it("builds a usable port from store credentials without issuing a request", () => {
    const port = epRequestPort({
      host: "https://euwest.api.elasticpath.com",
      clientId: "abc123",
    });

    expect(typeof port).toBe("function");
  });
});

describe("makeRequestPort", () => {
  it("surfaces Elastic Path's error envelope as the body when a request fails", async () => {
    const port = makeRequestPort({
      get: async () => ({
        error: {
          errors: [
            { detail: "You do not have permission to access this resource." },
          ],
        },
        response: { status: 403 },
      }),
    });

    await expect(port({ url: "https://host/v2/extensions/faqs", query: {} })).resolves.toEqual(
      {
        status: 403,
        body: {
          errors: [
            { detail: "You do not have permission to access this resource." },
          ],
        },
      }
    );
  });
});

describe("memoryTokenStore", () => {
  it("hands back the token it was given and forgets it when cleared", () => {
    const store = memoryTokenStore();

    expect(store.get()).toBeUndefined();

    store.set("token-from-the-mint");
    expect(store.get()).toBe("token-from-the-mint");

    store.set(undefined);
    expect(store.get()).toBeUndefined();
  });
});

describe("epClientConfig", () => {
  it("configures the client with the region host and the store's client id", () => {
    const { config, authOpts } = epClientConfig({
      host: "https://euwest.api.elasticpath.com",
      clientId: "abc123",
    });

    expect(config.baseUrl).toBe("https://euwest.api.elasticpath.com");
    expect(authOpts.clientId).toBe("abc123");
  });

  // The SDK's storage option accepts "localStorage" or "cookie" as well as an
  // adapter, and defaults to localStorage. Neither browser-backed option is
  // acceptable here: a designer's browser must not accumulate store tokens.
  it("supplies its own storage adapter rather than a browser-backed one", () => {
    const { authOpts } = epClientConfig({
      host: "https://euwest.api.elasticpath.com",
      clientId: "abc123",
    });

    expect(authOpts.storage).not.toBe("localStorage");
    expect(authOpts.storage).not.toBe("cookie");
    expect(typeof authOpts.storage).toBe("object");
  });
});
