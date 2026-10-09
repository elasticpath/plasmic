/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-var-requires */
import type { Cart } from "../../types/cart";

type RegistryModule = typeof import("../cart-cache-registry");

function loadCopy(): RegistryModule {
  let copy: RegistryModule | undefined;
  jest.isolateModules(() => {
    copy = require("../cart-cache-registry");
  });
  return copy as RegistryModule;
}

const CART = { id: "cart-1", items: [], promotions: [] } as unknown as Cart;

const write = () => Promise.resolve(CART);

function cacheSpy(show: (cart: Cart) => unknown = jest.fn()) {
  return { show: jest.fn(show), refetch: jest.fn() };
}

describe("cart cache registry", () => {
  it("keeps one entry per cache when the registering module is evaluated again", async () => {
    const copy = loadCopy();
    const cache = {};
    const first = cacheSpy();
    const second = cacheSpy();

    copy.registerEpCartCache(cache, first);
    copy.registerEpCartCache(cache, second);
    await copy.sequenceEpCartWrite(write);

    expect(first.show).not.toHaveBeenCalled();
    expect(second.show).toHaveBeenCalledTimes(1);
  });

  it("reaches a cache another copy of the package registered", async () => {
    const appCopy = loadCopy();
    const bundleCopy = loadCopy();
    const appCache = cacheSpy();
    const bundleCache = cacheSpy();

    appCopy.registerEpCartCache({}, appCache);
    bundleCopy.registerEpCartCache({}, bundleCache);
    await appCopy.sequenceEpCartWrite(write);

    expect(appCache.show).toHaveBeenCalledWith(CART);
    expect(bundleCache.show).toHaveBeenCalledWith(CART);
  });

  it("does not fail the write when a cache throws, and still reaches the others", async () => {
    const copy = loadCopy();
    const healthy = cacheSpy();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    copy.registerEpCartCache(
      {},
      cacheSpy(() => {
        throw new Error("cache gone");
      })
    );
    copy.registerEpCartCache(
      {},
      cacheSpy(() => Promise.reject(new Error("cache gone")))
    );
    copy.registerEpCartCache({}, healthy);

    await expect(copy.sequenceEpCartWrite(write)).resolves.toBe(CART);
    expect(healthy.show).toHaveBeenCalledWith(CART);
  });
});
