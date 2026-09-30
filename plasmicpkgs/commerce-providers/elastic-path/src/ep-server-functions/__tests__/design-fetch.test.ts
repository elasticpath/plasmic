/**
 * @jest-environment jsdom
 *
 * The design-time fork in `callEpProxy`, and the two realms behind it.
 *
 * The rule under test is "soft-fail where a mock floor exists, throw where
 * none does": the canvas artboard renders `"Sample"` fixtures behind a null,
 * and Studio's data-query Configure panel renders nothing behind one, so the
 * same null there is indistinguishable from a wrong argument binding.
 */

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callEpProxy } = require("../proxy-fetch");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  latchEpCanvasArtboard,
  resetEpCanvasArtboard,
  currentEpDesignRealm,
} = require("../design-realm");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resetEpDesignRouteWarning } = require("../design-fetch");

function inArtboard() {
  latchEpCanvasArtboard();
}

function inAppHostDocument() {
  (window as any).__CanvasPkgs = { React: {} };
}

beforeEach(() => {
  mockFetch.mockReset();
  resetEpCanvasArtboard();
  resetEpDesignRouteWarning();
  delete (window as any).__CanvasPkgs;
  jest.restoreAllMocks();
});

describe("design-time realm detection", () => {
  it("is off on a live storefront", () => {
    expect(currentEpDesignRealm()).toBeNull();
  });

  it("reads __CanvasPkgs per call, not at module load", () => {
    expect(currentEpDesignRealm()).toBeNull();
    inAppHostDocument();
    expect(currentEpDesignRealm()).toBe("app-host");
  });

  it("prefers the canvas context over __CanvasPkgs", () => {
    inAppHostDocument();
    inArtboard();
    expect(currentEpDesignRealm()).toBe("artboard");
  });
});

describe("callEpProxy at design time", () => {
  it("goes to the design route, with no credentials", async () => {
    inArtboard();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "p1" }) });

    await expect(callEpProxy("getProduct", { id: "p1" }, null)).resolves.toEqual(
      { id: "p1" }
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ep/design/getProduct",
      expect.objectContaining({ method: "POST", credentials: "omit" })
    );
  });

  it("serves all four declared names and nothing else", async () => {
    inArtboard();
    mockFetch.mockResolvedValue({ ok: true, json: async () => null });

    for (const fn of [
      "getProduct",
      "getProductList",
      "getProductPage",
      "getRelatedProducts",
    ]) {
      await callEpProxy(fn, {}, null);
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);

    mockFetch.mockReset();
    for (const fn of ["getCart", "getStock", "multiSearch"]) {
      await callEpProxy(fn, {}, null);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never retries a design failure against the session proxy", async () => {
    inArtboard();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ code: "dispatch_failed" }),
    });

    await expect(callEpProxy("getProduct", { id: "p1" }, null)).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/ep/design/getProduct");
  });

  it("throws on a transport failure even in the artboard", async () => {
    inArtboard();
    mockFetch.mockRejectedValue(new Error("offline"));

    // The caller's fallback is its own empty shape, not a mock floor: a null
    // from getProduct reads as "no such product". The components render their
    // labelled fixtures off their error branch, so the throw is what shows
    // them.
    await expect(callEpProxy("getProduct", { id: "p1" }, null)).rejects.toThrow(
      /offline/
    );
  });

  it("stays on the session proxy on a live storefront", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => null });

    await callEpProxy("getProduct", { id: "p1" }, null);

    expect(mockFetch.mock.calls[0][0]).toBe("/api/ep/proxy/getProduct");
  });
});

describe("an operation the design route cannot serve", () => {
  it("soft-fails in the artboard, where fixtures render behind the null", async () => {
    inArtboard();
    await expect(callEpProxy("getCart", {}, null)).resolves.toBeNull();
  });

  it("soft-fails the cart mutations in the artboard too", async () => {
    inArtboard();
    // They pass no fallback, so the value is `undefined`. A mutation has no
    // result to render at design time; what matters is that the artboard does
    // not surface an error a designer cannot act on.
    await expect(
      callEpProxy("addCartItem", { productId: "p1" })
    ).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws in the Configure panel, naming the cause", async () => {
    inAppHostDocument();
    await expect(callEpProxy("getCart", {}, null)).rejects.toThrow(
      /"getCart" is not served at design time/
    );
    await expect(callEpProxy("getCart", {}, null)).rejects.toThrow(
      /getProduct, getProductList, getProductPage, getRelatedProducts/
    );
  });
});

describe("an unmounted design route", () => {
  it("warns once, naming the route and how to mount it", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    inArtboard();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("html");
      },
    });

    await expect(
      callEpProxy("getProduct", { id: "p1" }, null)
    ).rejects.toMatchObject({ code: "route_not_found" });
    await expect(callEpProxy("getProductList", {}, [])).rejects.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("/api/ep/design/<fn>");
    expect(message).toContain("createEpDesignRoutes");
    expect(message).toContain("app/api/ep/design/[fn]/route.ts");
  });

  it("carries route_not_found into the Configure panel's error", async () => {
    inAppHostDocument();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("html");
      },
    });

    await expect(
      callEpProxy("getProduct", { id: "p1" }, null)
    ).rejects.toMatchObject({ code: "route_not_found" });
  });
});
