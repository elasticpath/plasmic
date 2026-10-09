/**
 * @jest-environment jsdom
 *
 * The cart writes a storefront developer's own component imports from the
 * root entry. In the browser they reach the storefront's proxy route, the way
 * the shipped cart components do, and every `useEpCart()` consumer on the page
 * shows the cart the write produced.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { mutate, SWRConfig } from "swr";
import {
  epAddCartItem,
  epRemoveCartItem,
  epUpdateCartItem,
  useEpCart,
} from "../../index";
import * as serverFunctions from "../../ep-server-functions";
import { registerEpCartCacheSeed } from "../../ep-server-functions/cart-cache-seed";
import {
  latchEpCanvasArtboard,
  resetEpCanvasArtboard,
} from "../../ep-server-functions/design-realm";
import { epCartCacheKey } from "../cache-keys";

type ProxyCall = { fn: string; body: Record<string, unknown> };

function cartWith(lines: Array<{ id: string; quantity: number; location?: string }>) {
  return {
    id: "cart-1",
    items: lines.map((l) => ({ ...l, type: "cart_item", name: `Line ${l.id}` })),
    promotions: [],
  };
}

const NOT_JSON = Symbol("an HTML error page");

/** A storefront proxy route backed by one shopper's cart. */
function fakeProxy() {
  const calls: ProxyCall[] = [];
  let cart = cartWith([]);
  let failure: { status: number; body: unknown } | null = null;
  let unreachable = false;

  const fetchStub = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const fn = url.replace("/api/ep/proxy/", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ fn, body });
    const respond = (status: number, payload: unknown) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (payload === NOT_JSON) throw new SyntaxError("Unexpected token <");
          return payload;
        },
      }) as unknown as Response;

    if (fn !== "getCart" && unreachable) throw new TypeError("Failed to fetch");
    if (fn !== "getCart" && failure) return respond(failure.status, failure.body);
    switch (fn) {
      case "getCart":
        return respond(200, cart);
      case "addCartItem":
        cart = cartWith([
          ...cart.items,
          { id: "li-new", quantity: body.quantity, location: body.location },
        ]);
        return respond(200, cart);
      case "updateCartItem":
        cart = cartWith(
          cart.items.map((l) =>
            l.id === body.itemId ? { ...l, quantity: body.quantity } : l
          )
        );
        return respond(200, cart);
      case "removeCartItem":
        cart = cartWith(cart.items.filter((l) => l.id !== body.itemId));
        return respond(200, cart);
      default:
        return respond(404, { code: "unknown_fn" });
    }
  });

  return {
    fetchStub,
    calls,
    seed(lines: Parameters<typeof cartWith>[0]) {
      cart = cartWith(lines);
    },
    failWith(status: number, body: unknown) {
      failure = { status, body };
    },
    failToConnect() {
      unreachable = true;
    },
  };
}

function CartBadge() {
  const { cart, isLoading } = useEpCart();
  if (isLoading) return <span>loading</span>;
  const lines = cart?.items ?? [];
  return (
    <span data-testid="badge">
      {lines.map((l) => `${l.id}x${l.quantity}`).join(",") || "empty"}
    </span>
  );
}

let proxy: ReturnType<typeof fakeProxy>;

beforeEach(async () => {
  proxy = fakeProxy();
  (globalThis as { fetch?: unknown }).fetch = proxy.fetchStub;
  await mutate(epCartCacheKey(), undefined, false);
});

async function renderBadge(expected: string) {
  render(
    <SWRConfig value={{ dedupingInterval: 0 }}>
      <CartBadge />
    </SWRConfig>
  );
  await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe(expected));
}

describe("cart writes from the root entry", () => {
  it("are the very functions /server exports", () => {
    expect(epAddCartItem).toBe(serverFunctions.epAddCartItem);
    expect(epUpdateCartItem).toBe(serverFunctions.epUpdateCartItem);
    expect(epRemoveCartItem).toBe(serverFunctions.epRemoveCartItem);
  });

  it("adds an item at a location and resolves with the updated cart", async () => {
    await renderBadge("empty");

    let cart: Awaited<ReturnType<typeof epAddCartItem>> | undefined;
    await act(async () => {
      cart = await epAddCartItem({
        productId: "prod-1",
        quantity: 2,
        location: "warehouse-north",
      });
    });

    expect(proxy.calls).toContainEqual({
      fn: "addCartItem",
      body: { productId: "prod-1", quantity: 2, location: "warehouse-north" },
    });
    expect(cart?.items).toEqual([
      expect.objectContaining({ id: "li-new", quantity: 2, location: "warehouse-north" }),
    ]);
    await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("li-newx2"));
  });

  it("updates a line's quantity and the cart's readers show it", async () => {
    proxy.seed([{ id: "li-1", quantity: 1 }]);
    await renderBadge("li-1x1");

    let cart: Awaited<ReturnType<typeof epUpdateCartItem>> | undefined;
    await act(async () => {
      cart = await epUpdateCartItem({ itemId: "li-1", quantity: 3 });
    });

    expect(cart?.items).toEqual([expect.objectContaining({ id: "li-1", quantity: 3 })]);
    await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("li-1x3"));
  });

  it("removes a line and the cart's readers show it gone", async () => {
    proxy.seed([
      { id: "li-1", quantity: 1 },
      { id: "li-2", quantity: 4 },
    ]);
    await renderBadge("li-1x1,li-2x4");

    let cart: Awaited<ReturnType<typeof epRemoveCartItem>> | undefined;
    await act(async () => {
      cart = await epRemoveCartItem({ itemId: "li-1" });
    });

    expect(cart?.items).toEqual([expect.objectContaining({ id: "li-2" })]);
    await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("li-2x4"));
  });

  it("resolves a write that succeeded when another cache fails to take the cart", async () => {
    const brokenCache = {};
    registerEpCartCacheSeed(brokenCache, () => {
      throw new Error("cache gone");
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await renderBadge("empty");

      let cart: Awaited<ReturnType<typeof epAddCartItem>> | undefined;
      await act(async () => {
        cart = await epAddCartItem({ productId: "prod-1", quantity: 1 });
      });

      expect(cart?.items).toEqual([expect.objectContaining({ id: "li-new" })]);
      await waitFor(() => expect(screen.getByTestId("badge").textContent).toBe("li-newx1"));
    } finally {
      registerEpCartCacheSeed(brokenCache, () => undefined);
    }
  });

  it("rejects an out-of-stock add with a readable error and leaves the cart as it was", async () => {
    proxy.seed([{ id: "li-1", quantity: 1 }]);
    await renderBadge("li-1x1");
    // A production proxy withholds Elastic Path's message and sends only a code.
    proxy.failWith(500, {
      error: "dispatch_failed",
      code: "insufficient_stock",
      correlationId: "corr-1",
    });

    let caught: (Error & { code?: string; correlationId?: string }) | undefined;
    await act(async () => {
      caught = await epAddCartItem({ productId: "prod-1", quantity: 99 }).then(
        () => undefined,
        (err) => err
      );
    });

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/enough stock/i);
    expect(caught?.code).toBe("insufficient_stock");
    expect(caught?.correlationId).toBe("corr-1");
    expect(screen.getByTestId("badge").textContent).toBe("li-1x1");
  });

  it("keeps Elastic Path's own reason when the proxy sends it", async () => {
    // A development proxy route's response; proxy-cart-write-errors.test.ts drives the real route.
    proxy.failWith(500, {
      error: "dispatch_failed",
      code: "insufficient_stock",
      correlationId: "corr-1",
      message: "epAddCartItem: The requested quantity exceeds the available stock",
    });

    await expect(epAddCartItem({ productId: "prod-1", quantity: 99 })).rejects.toThrow(
      "epAddCartItem: The requested quantity exceeds the available stock"
    );
  });

  it("rejects a failure with no known cause with a readable error, not the bare code", async () => {
    proxy.failWith(500, { error: "dispatch_failed", code: "dispatch_failed" });

    const caught = await epRemoveCartItem({ itemId: "li-1" }).then(
      () => undefined,
      (err) => err as Error & { code?: string }
    );

    expect(caught?.message).not.toBe("dispatch_failed");
    expect(caught?.message).toMatch(/couldn't remove/i);
    expect(caught?.code).toBe("dispatch_failed");
  });
});

describe("every cart write rejection reads as shopper copy", () => {
  async function rejectionOf(write: () => Promise<unknown>) {
    return write().then(
      () => undefined,
      (err) => err as Error & { code?: string; correlationId?: string }
    );
  }

  it("when the proxy route is not mounted", async () => {
    proxy.failWith(404, { error: "Not Found" });

    const caught = await rejectionOf(() =>
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    );

    expect(caught?.message).toBe(
      "We couldn't add this item to your cart. Please try again."
    );
    expect(caught?.code).toBe("route_not_found");
  });

  it("when the proxy route answers a 405", async () => {
    proxy.failWith(405, NOT_JSON);

    const caught = await rejectionOf(() =>
      epUpdateCartItem({ itemId: "li-1", quantity: 2 })
    );

    expect(caught?.message).toBe("We couldn't update the quantity. Please try again.");
    expect(caught?.code).toBe("route_not_found");
  });

  it("when the server fails with an error page and no code", async () => {
    proxy.failWith(502, NOT_JSON);

    const caught = await rejectionOf(() => epRemoveCartItem({ itemId: "li-1" }));

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe("We couldn't remove this item. Please try again.");
  });

  it("when the network is down", async () => {
    proxy.failToConnect();

    const caught = await rejectionOf(() =>
      epAddCartItem({ productId: "prod-1", quantity: 1 })
    );

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe(
      "We couldn't add this item to your cart. Please try again."
    );
  });

  it("keeps the correlation id of a coded failure", async () => {
    proxy.failWith(401, { error: "no_session", code: "no_session", correlationId: "corr-2" });

    const caught = await rejectionOf(() => epRemoveCartItem({ itemId: "li-1" }));

    expect(caught?.message).toMatch(/session expired/i);
    expect(caught?.code).toBe("no_session");
    expect(caught?.correlationId).toBe("corr-2");
  });
});

describe("cart writes on the Studio artboard", () => {
  afterEach(() => resetEpCanvasArtboard());

  it.each([
    ["an add", () => epAddCartItem({ productId: "prod-1", quantity: 1 })],
    ["an update", () => epUpdateCartItem({ itemId: "li-1", quantity: 2 })],
    ["a remove", () => epRemoveCartItem({ itemId: "li-1" })],
  ])("rejects %s with a readable error and leaves the cart as it was", async (_, writeCart) => {
    proxy.seed([{ id: "li-1", quantity: 1 }]);
    await renderBadge("li-1x1");
    latchEpCanvasArtboard();

    let caught: (Error & { code?: string }) | undefined;
    await act(async () => {
      caught = await writeCart().then(
        () => undefined,
        (err) => err
      );
    });

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/studio/i);
    expect(caught?.code).toBe("design_fn_not_served");
    expect(screen.getByTestId("badge").textContent).toBe("li-1x1");
  });
});

describe("cart writes in the configure panel", () => {
  beforeEach(() => {
    (window as unknown as { __CanvasPkgs?: unknown }).__CanvasPkgs = {};
  });
  afterEach(() => {
    delete (window as unknown as { __CanvasPkgs?: unknown }).__CanvasPkgs;
  });

  it.each([
    ["an add", () => epAddCartItem({ productId: "prod-1", quantity: 1 })],
    ["an update", () => epUpdateCartItem({ itemId: "li-1", quantity: 2 })],
    ["a remove", () => epRemoveCartItem({ itemId: "li-1" })],
  ])("rejects %s with copy that names the configure panel", async (_, writeCart) => {
    const caught: (Error & { code?: string }) | undefined = await writeCart().then(
      () => undefined,
      (err) => err
    );

    expect(caught?.message).toBe(
      "Cart changes don't run in the configure panel. Preview the page to try them."
    );
    expect(caught?.code).toBe("design_fn_not_served");
    expect(proxy.calls).toEqual([]);
  });
});
