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
import { registerEpCartCache } from "../../ep-server-functions/cart-cache-registry";
import type { Cart } from "../../types/cart";
import {
  latchEpCanvasArtboard,
  resetEpCanvasArtboard,
} from "../../ep-server-functions/design-realm";
import { epCartCacheKey } from "../cache-keys";
import { DataProvider } from "@plasmicapp/host";
import { EPCartItemQuantityControl } from "../../cart-drawer/EPCartItemQuantityControl";
import {
  useCartItemQuantity,
  type CartItemQuantityContextValue,
} from "../../cart-drawer/CartDrawerContext";

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
  let nextFailure: { status: number; body: unknown } | null = null;
  let unreachable = false;
  let holding = false;
  const held: Array<() => void> = [];

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
    const response = answer(fn, body, respond);
    if (fn === "getCart" || !holding) return response;
    return new Promise<Response>((resolve) => held.push(() => resolve(response)));
  });

  function answer(
    fn: string,
    body: Record<string, any>,
    respond: (status: number, payload: unknown) => Response
  ): Response {
    if (fn !== "getCart" && nextFailure) {
      const { status, body: payload } = nextFailure;
      nextFailure = null;
      return respond(status, payload);
    }
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
  }

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
    /** Elastic Path fails the next write; its response is still held like any other. */
    failNextWrite(status: number, body: unknown) {
      nextFailure = { status, body };
    },
    /** Elastic Path applies each write as it arrives, but its response waits for `release`. */
    holdWrites() {
      holding = true;
    },
    heldWrites: () => held.length,
    /** Sends the response to the write that arrived `index`-th (from 0). */
    release(index: number) {
      held[index]();
    },
    reads: () => calls.filter((c) => c.fn === "getCart").length,
  };
}

/** Every cart a reader has rendered, in order. */
let shown: Record<string, string[]>;

function CartReader({ testId }: { testId: string }) {
  const { cart, isLoading } = useEpCart();
  if (isLoading) return <span>loading</span>;
  const lines = cart?.items ?? [];
  const text = lines.map((l) => `${l.id}x${l.quantity}`).join(",") || "empty";
  const log = (shown[testId] ??= []);
  if (log[log.length - 1] !== text) log.push(text);
  return <span data-testid={testId}>{text}</span>;
}

function CartBadge() {
  return <CartReader testId="badge" />;
}

let proxy: ReturnType<typeof fakeProxy>;

beforeEach(async () => {
  shown = {};
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

  it("resolves a write that succeeded when another cache fails to show the cart", async () => {
    const brokenCache = {};
    registerEpCartCache(brokenCache, {
      show: () => {
        throw new Error("cache gone");
      },
      refetch: () => undefined,
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
      registerEpCartCache(brokenCache, { show: () => undefined, refetch: () => undefined });
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

describe("overlapping cart writes", () => {
  type Outcome = { cart?: Cart; error?: Error & { code?: string } };

  const text = (testId: string) => screen.getByTestId(testId).textContent;
  let readsBefore: number;

  async function renderReaders(expected: string, extra?: React.ReactNode) {
    render(
      <SWRConfig value={{ dedupingInterval: 0 }}>
        <CartReader testId="badge" />
        <CartReader testId="drawer" />
        {extra}
      </SWRConfig>
    );
    await waitFor(() => {
      expect(text("badge")).toBe(expected);
      expect(text("drawer")).toBe(expected);
    });
    readsBefore = proxy.reads();
  }

  function start(write: () => Promise<Cart>): Promise<Outcome> {
    return write().then(
      (cart) => ({ cart }),
      (error) => ({ error })
    );
  }

  async function startHeld(...writes: Array<() => Promise<Cart>>) {
    proxy.holdWrites();
    const outcomes = writes.map(start);
    await waitFor(() => expect(proxy.heldWrites()).toBe(writes.length));
    return outcomes;
  }

  async function release(index: number, outcome: Promise<Outcome>) {
    let result: Outcome = {};
    await act(async () => {
      proxy.release(index);
      result = await outcome;
    });
    return result;
  }

  async function expectSettledOn(expected: string, cartReads: number) {
    await waitFor(() => {
      expect(proxy.reads() - readsBefore).toBe(cartReads);
      expect(text("badge")).toBe(expected);
      expect(text("drawer")).toBe(expected);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(proxy.reads() - readsBefore).toBe(cartReads);
    expect(text("badge")).toBe(expected);
    expect(text("drawer")).toBe(expected);
  }

  function expectNeverShownAfter(newer: string, older: string) {
    for (const log of [shown.badge, shown.drawer]) {
      expect(log.slice(log.indexOf(newer))).not.toContain(older);
    }
  }

  beforeEach(() => proxy.seed([{ id: "li-1", quantity: 1 }]));

  const setQuantity = (quantity: number) => () =>
    epUpdateCartItem({ itemId: "li-1", quantity });

  it("shows a single write in every reader without reading the cart again", async () => {
    await renderReaders("li-1x1");

    await act(async () => {
      await epUpdateCartItem({ itemId: "li-1", quantity: 2 });
    });

    await expectSettledOn("li-1x2", 0);
  });

  it("released in the order they were sent, end on the newest cart and read it once", async () => {
    await renderReaders("li-1x1");
    const [first, second] = await startHeld(setQuantity(2), setQuantity(3));

    await release(0, first);
    await release(1, second);

    await expectSettledOn("li-1x3", 1);
  });

  it("released in reverse, never show the older cart and end on the cart Elastic Path holds", async () => {
    await renderReaders("li-1x1");
    const [first, second] = await startHeld(setQuantity(2), setQuantity(3));

    await release(1, second);
    await waitFor(() => expect(text("badge")).toBe("li-1x3"));
    proxy.seed([{ id: "li-1", quantity: 4 }]);
    await release(0, first);

    await expectSettledOn("li-1x4", 1);
    expect(shown.badge).not.toContain("li-1x2");
    expect(shown.drawer).not.toContain("li-1x2");
  });

  it("resolve each call with the cart that call produced, even one the readers never show", async () => {
    await renderReaders("li-1x1");
    const [first, second] = await startHeld(setQuantity(2), setQuantity(3));

    const secondResult = await release(1, second);
    const firstResult = await release(0, first);

    expect(secondResult.cart?.items).toEqual([
      expect.objectContaining({ id: "li-1", quantity: 3 }),
    ]);
    expect(firstResult.cart?.items).toEqual([
      expect.objectContaining({ id: "li-1", quantity: 2 }),
    ]);
    await expectSettledOn("li-1x3", 1);
  });

  it("with one failure, still end on the cart Elastic Path holds and read it once", async () => {
    await renderReaders("li-1x1");
    proxy.holdWrites();
    const first = start(setQuantity(2));
    proxy.failNextWrite(500, { error: "dispatch_failed", code: "insufficient_stock" });
    const second = start(setQuantity(99));
    await waitFor(() => expect(proxy.heldWrites()).toBe(2));

    const failed = await release(1, second);
    await release(0, first);

    expect(failed.error?.code).toBe("insufficient_stock");
    await expectSettledOn("li-1x2", 1);
  });

  it("read the cart once for three rapid writes, not three times", async () => {
    await renderReaders("li-1x1");
    const [first, second, third] = await startHeld(
      setQuantity(2),
      setQuantity(3),
      setQuantity(4)
    );

    await release(1, second);
    await release(2, third);
    await release(0, first);

    await expectSettledOn("li-1x4", 1);
    expectNeverShownAfter("li-1x3", "li-1x2");
  });

  it("read the cart once when the reader's module has been evaluated again", async () => {
    const sameSwr = jest.requireActual("swr");
    jest.doMock("swr", () => sameSwr);
    try {
      jest.isolateModules(() => {
        require("../use-ep-cart");
      });
    } finally {
      jest.dontMock("swr");
    }
    await renderReaders("li-1x1");
    const [first, second] = await startHeld(setQuantity(2), setQuantity(3));

    await release(1, second);
    await release(0, first);

    await expectSettledOn("li-1x3", 1);
  });

  describe("with a failed write from the quantity control", () => {
    let control: CartItemQuantityContextValue | null = null;

    function TakeControl() {
      control = useCartItemQuantity();
      return null;
    }

    const quantityControlFor = (line: { id: string; quantity: number }) => (
      <DataProvider name="currentCartItem" data={line}>
        <EPCartItemQuantityControl>
          <TakeControl />
        </EPCartItemQuantityControl>
      </DataProvider>
    );

    beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it("alone, put the control back and read the cart once", async () => {
      await renderReaders("li-1x1", quantityControlFor({ id: "li-1", quantity: 1 }));
      proxy.failWith(500, { error: "dispatch_failed", code: "insufficient_stock" });

      act(() => control!.increment());

      await expectSettledOn("li-1x1", 1);
      expect(control!.quantity).toBe(1);
      expect(control!.isLoading).toBe(false);
    });

    it.each([
      ["before", [1, 0]],
      ["after", [0, 1]],
    ])("finishing %s the other write, read the cart once", async (_, order) => {
      proxy.seed([
        { id: "li-1", quantity: 1 },
        { id: "li-2", quantity: 1 },
      ]);
      await renderReaders(
        "li-1x1,li-2x1",
        quantityControlFor({ id: "li-1", quantity: 1 })
      );
      proxy.holdWrites();
      const other = start(() => epUpdateCartItem({ itemId: "li-2", quantity: 5 }));
      await waitFor(() => expect(proxy.heldWrites()).toBe(1));
      proxy.failNextWrite(500, { error: "dispatch_failed", code: "insufficient_stock" });
      act(() => control!.increment());
      await waitFor(() => expect(proxy.heldWrites()).toBe(2));

      for (const index of order) {
        await act(async () => proxy.release(index));
      }
      await act(async () => {
        await other;
      });

      await expectSettledOn("li-1x1,li-2x5", 1);
      expect(control!.quantity).toBe(1);
    });
  });

  describe("with a write rejected on the Studio artboard", () => {
    afterEach(() => resetEpCanvasArtboard());

    it("treat it as no write at all", async () => {
      await renderReaders("li-1x1");
      const [first] = await startHeld(setQuantity(2));

      latchEpCanvasArtboard();
      const canvas = await start(setQuantity(5));
      resetEpCanvasArtboard();
      await release(0, first);

      expect(canvas.error?.code).toBe("design_fn_not_served");
      await expectSettledOn("li-1x2", 0);
    });
  });

  describe("from two copies of the package on one page", () => {
    const otherCopysCache = {};
    afterEach(() =>
      registerEpCartCache(otherCopysCache, {
        show: () => undefined,
        refetch: () => undefined,
      })
    );

    it("are ordered together, and every copy's cache reads the cart once", async () => {
      const show = jest.fn();
      const refetch = jest.fn();
      registerEpCartCache(otherCopysCache, { show, refetch });
      let otherCopy: typeof serverFunctions | undefined;
      jest.isolateModules(() => {
        otherCopy = require("../../ep-server-functions");
      });
      await renderReaders("li-1x1");
      const [first, second] = await startHeld(setQuantity(2), () =>
        otherCopy!.epUpdateCartItem({ itemId: "li-1", quantity: 3 })
      );

      await release(1, second);
      await release(0, first);

      await expectSettledOn("li-1x3", 1);
      expect(shown.badge).not.toContain("li-1x2");
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(show.mock.calls.map(([cart]) => cart.items[0].quantity)).toEqual([3]);
    });

    it("do not count a write sent after the last one returned, while a slow copy still shows its cart", async () => {
      let finishShowing: () => void = () => {};
      const slowShow = jest.fn(
        () => new Promise<void>((resolve) => (finishShowing = resolve))
      );
      registerEpCartCache(otherCopysCache, { show: slowShow, refetch: () => undefined });
      await renderReaders("li-1x1");

      const first = start(setQuantity(2));
      await waitFor(() => expect(slowShow).toHaveBeenCalledTimes(1));
      registerEpCartCache(otherCopysCache, { show: () => undefined, refetch: () => undefined });
      const second = start(setQuantity(3));
      await act(async () => {
        await second;
        finishShowing();
        await first;
      });

      await expectSettledOn("li-1x3", 0);
    });
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
