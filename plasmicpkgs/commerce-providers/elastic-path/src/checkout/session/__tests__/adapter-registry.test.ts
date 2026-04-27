/**
 * A-10.2: AdapterRegistry tests
 *
 * Verifies register/getAdapter semantics: successful retrieval, undefined for
 * unknown names, and independent storage of multiple adapters.
 */
import { createAdapterRegistry } from "../adapter-registry";
import type { PaymentAdapter } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(): PaymentAdapter {
  return {
    initializePayment: jest.fn().mockResolvedValue({ status: "ready" }),
    confirmPayment: jest.fn().mockResolvedValue({ status: "succeeded" }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAdapterRegistry", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns an object with register and getAdapter methods", () => {
    const registry = createAdapterRegistry();
    expect(typeof registry.register).toBe("function");
    expect(typeof registry.getAdapter).toBe("function");
  });

  it("getAdapter returns undefined for an unknown name", () => {
    const registry = createAdapterRegistry();
    expect(registry.getAdapter("stripe")).toBeUndefined();
    expect(registry.getAdapter("clover")).toBeUndefined();
    expect(registry.getAdapter("")).toBeUndefined();
  });

  it("returns the registered adapter by name", () => {
    const registry = createAdapterRegistry();
    const adapter = makeAdapter();
    registry.register("stripe", adapter);
    expect(registry.getAdapter("stripe")).toBe(adapter);
  });

  it("returns undefined for a different name after one adapter registered", () => {
    const registry = createAdapterRegistry();
    registry.register("stripe", makeAdapter());
    expect(registry.getAdapter("clover")).toBeUndefined();
  });

  it("supports registering multiple adapters independently", () => {
    const registry = createAdapterRegistry();
    const stripeAdapter = makeAdapter();
    const cloverAdapter = makeAdapter();

    registry.register("stripe", stripeAdapter);
    registry.register("clover", cloverAdapter);

    expect(registry.getAdapter("stripe")).toBe(stripeAdapter);
    expect(registry.getAdapter("clover")).toBe(cloverAdapter);
    expect(registry.getAdapter("stripe")).not.toBe(cloverAdapter);
  });

  it("overwrites an adapter when the same name is registered twice", () => {
    const registry = createAdapterRegistry();
    const first = makeAdapter();
    const second = makeAdapter();

    registry.register("stripe", first);
    registry.register("stripe", second);

    expect(registry.getAdapter("stripe")).toBe(second);
    expect(registry.getAdapter("stripe")).not.toBe(first);
  });

  it("each createAdapterRegistry call produces an isolated registry", () => {
    const reg1 = createAdapterRegistry();
    const reg2 = createAdapterRegistry();
    const adapter = makeAdapter();

    reg1.register("clover", adapter);

    expect(reg1.getAdapter("clover")).toBe(adapter);
    expect(reg2.getAdapter("clover")).toBeUndefined();
  });
});
