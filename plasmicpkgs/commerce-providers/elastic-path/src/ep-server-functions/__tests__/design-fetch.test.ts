/**
 * @jest-environment jsdom
 */
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

const { callEpProxy } = require("../proxy-fetch");
const {
  latchEpCanvasArtboard,
  resetEpCanvasArtboard,
  currentEpDesignRealm,
} = require("../design-realm");
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

  it("serves the declared names and nothing else", async () => {
    inArtboard();
    mockFetch.mockResolvedValue({ ok: true, json: async () => null });

    for (const fn of [
      "getProduct",
      "getProductList",
      "getProductPage",
      "getRelatedProducts",
      "getSearchAttributes",
    ]) {
      await callEpProxy(fn, {}, null);
    }
    expect(mockFetch).toHaveBeenCalledTimes(5);

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
      /getProduct, getProductList, getProductPage, getRelatedProducts, getSearchAttributes/
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

  const NOT_MOUNTED: Array<[string, number, () => Promise<unknown>]> = [
    ["a static host's empty 405", 405, async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    }],
    ["a framework's 405 with its own code", 405, async () => ({
      code: "METHOD_NOT_ALLOWED",
      message: "Method Not Allowed",
    })],
    ["a framework's 404 with its own code", 404, async () => ({
      error: { code: "NOT_FOUND", message: "The page could not be found" },
      code: "NOT_FOUND",
    })],
  ];

  it.each(NOT_MOUNTED)("warns once for %s, and fails as before", async (_label, status, json) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    inArtboard();
    mockFetch.mockResolvedValue({ ok: false, status, json });

    const first = await callEpProxy("getProduct", { id: "p1" }, null).catch((e: unknown) => e);
    await expect(callEpProxy("getProductList", {}, [])).rejects.toThrow();

    expect(first).toBeInstanceOf(Error);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("createEpDesignRoutes");
  });

  it("does not ask to mount a route that is mounted but does not serve the function", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    inArtboard();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: "not_served",
        code: "design_fn_not_served",
        fn: "getProduct",
        message: "not served",
      }),
    });

    await expect(callEpProxy("getProduct", { id: "p1" }, null)).rejects.toMatchObject({
      code: "design_fn_not_served",
    });
    expect(warn).not.toHaveBeenCalled();
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
