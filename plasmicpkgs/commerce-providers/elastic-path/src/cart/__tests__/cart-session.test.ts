/** The accessors follow the mount path their caller was given. */
import { getCartIdFromSession, setCartIdInSession } from "../cart-session";

const originalFetch = globalThis.fetch;
let calls: { url: string; init: any }[] = [];

function respond(body: unknown, ok = true) {
  calls = [];
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
}

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
});

describe("getCartIdFromSession", () => {
  it("reads the cart the envelope points at", async () => {
    respond({ session: { epCartId: "cart-7" } });

    await expect(getCartIdFromSession()).resolves.toBe("cart-7");
    expect(calls[0].url).toBe("/api/ep/get-session");
  });

  it("follows a handler the consumer mounted elsewhere", async () => {
    respond({ session: { epCartId: "cart-7" } });

    await getCartIdFromSession("/api/store");

    expect(calls[0].url).toBe("/api/store/get-session");
  });

  it("reports no cart rather than failing when there is no session", async () => {
    respond(null);

    await expect(getCartIdFromSession()).resolves.toBeUndefined();
  });

  it("reports no cart rather than failing when the handler refuses", async () => {
    respond({ error: "no_session" }, false);

    await expect(getCartIdFromSession()).resolves.toBeUndefined();
  });
});

describe("setCartIdInSession", () => {
  it("points the envelope at the cart", async () => {
    respond({ session: { epCartId: "cart-9" } });

    await setCartIdInSession("cart-9");

    expect(calls[0].url).toBe("/api/ep/ep/cart");
    expect(JSON.parse(calls[0].init.body)).toEqual({ cartId: "cart-9" });
  });

  it("follows a handler the consumer mounted elsewhere", async () => {
    respond({ session: {} });

    await setCartIdInSession("cart-9", "/api/store");

    expect(calls[0].url).toBe("/api/store/ep/cart");
  });

  it("swallows a failed write, which the next page load re-derives", async () => {
    respond({ error: "no_session" }, false);

    await expect(setCartIdInSession("cart-9")).resolves.toBeUndefined();
  });
});
