/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-var-requires */
import type { Cart } from "../../types/cart";

type SeedModule = typeof import("../cart-cache-seed");

function loadCopy(): SeedModule {
  let copy: SeedModule | undefined;
  jest.isolateModules(() => {
    copy = require("../cart-cache-seed");
  });
  return copy as SeedModule;
}

const CART = { id: "cart-1", items: [], promotions: [] } as unknown as Cart;

describe("cart cache seeds", () => {
  it("keeps one seed per cache when the registering module is evaluated again", async () => {
    const seeds = loadCopy();
    const cache = {};
    const first = jest.fn();
    const second = jest.fn();

    seeds.registerEpCartCacheSeed(cache, first);
    seeds.registerEpCartCacheSeed(cache, second);
    await seeds.seedEpCartCaches(CART);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reaches a cache another copy of the package registered", async () => {
    const appCopy = loadCopy();
    const bundleCopy = loadCopy();
    const appSeed = jest.fn();
    const bundleSeed = jest.fn();

    appCopy.registerEpCartCacheSeed({}, appSeed);
    bundleCopy.registerEpCartCacheSeed({}, bundleSeed);
    await appCopy.seedEpCartCaches(CART);

    expect(appSeed).toHaveBeenCalledWith(CART);
    expect(bundleSeed).toHaveBeenCalledWith(CART);
  });

  it("does not fail when a seed throws, and still runs the others", async () => {
    const seeds = loadCopy();
    const healthy = jest.fn();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    seeds.registerEpCartCacheSeed({}, () => {
      throw new Error("cache gone");
    });
    seeds.registerEpCartCacheSeed({}, () => Promise.reject(new Error("cache gone")));
    seeds.registerEpCartCacheSeed({}, healthy);

    await expect(seeds.seedEpCartCaches(CART)).resolves.toBeUndefined();
    expect(healthy).toHaveBeenCalledWith(CART);
  });
});
