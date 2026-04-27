/**
 * D-6.1: Cart hash tests
 *
 * Verifies the determinism invariants required for the /pay cart-mismatch
 * guard: same cart in any item order produces the same hash, and any
 * meaningful mutation (quantity, price, identity) produces a different hash.
 */
import { hashCart } from "../cart-hash";
import type { CartItemForHash } from "../cart-hash";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ITEM_A: CartItemForHash = {
  id: "item-aaa",
  quantity: 2,
  unit_price: { amount: 1500 },
};

const ITEM_B: CartItemForHash = {
  id: "item-bbb",
  quantity: 1,
  unit_price: { amount: 2400 },
};

const ITEM_C: CartItemForHash = {
  id: "item-ccc",
  quantity: 3,
  unit_price: { amount: 999 },
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("hashCart — determinism", () => {
  it("produces the same hash for the same single item", () => {
    expect(hashCart([ITEM_A])).toBe(hashCart([ITEM_A]));
  });

  it("produces the same hash regardless of item order (two items)", () => {
    const hash1 = hashCart([ITEM_A, ITEM_B]);
    const hash2 = hashCart([ITEM_B, ITEM_A]);
    expect(hash1).toBe(hash2);
  });

  it("produces the same hash regardless of item order (three items)", () => {
    const hash1 = hashCart([ITEM_A, ITEM_B, ITEM_C]);
    const hash2 = hashCart([ITEM_C, ITEM_A, ITEM_B]);
    const hash3 = hashCart([ITEM_B, ITEM_C, ITEM_A]);
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("produces a consistent hash for an empty cart", () => {
    expect(hashCart([])).toBe(hashCart([]));
  });

  it("produces a hex string of length 64 (SHA-256)", () => {
    const hash = hashCart([ITEM_A]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Sensitivity to mutations
// ---------------------------------------------------------------------------

describe("hashCart — mutation sensitivity", () => {
  it("produces a different hash when quantity changes", () => {
    const original = hashCart([ITEM_A]);
    const mutated = hashCart([{ ...ITEM_A, quantity: ITEM_A.quantity + 1 }]);
    expect(original).not.toBe(mutated);
  });

  it("produces a different hash when unit_price changes", () => {
    const original = hashCart([ITEM_A]);
    const mutated = hashCart([
      { ...ITEM_A, unit_price: { amount: ITEM_A.unit_price!.amount! + 1 } },
    ]);
    expect(original).not.toBe(mutated);
  });

  it("produces a different hash when an item is added", () => {
    const original = hashCart([ITEM_A]);
    const withExtra = hashCart([ITEM_A, ITEM_B]);
    expect(original).not.toBe(withExtra);
  });

  it("produces a different hash when an item is removed", () => {
    const full = hashCart([ITEM_A, ITEM_B]);
    const partial = hashCart([ITEM_A]);
    expect(full).not.toBe(partial);
  });

  it("produces a different hash when item id changes", () => {
    const original = hashCart([ITEM_A]);
    const mutated = hashCart([{ ...ITEM_A, id: "item-zzz" }]);
    expect(original).not.toBe(mutated);
  });

  it("empty cart hash differs from non-empty cart hash", () => {
    expect(hashCart([])).not.toBe(hashCart([ITEM_A]));
  });
});

// ---------------------------------------------------------------------------
// value.amount fallback
// ---------------------------------------------------------------------------

describe("hashCart — price field fallback", () => {
  it("uses value.amount when unit_price is absent", () => {
    const itemWithValue: CartItemForHash = {
      id: "item-val",
      quantity: 2,
      value: { amount: 1500 },
    };
    const itemWithUnitPrice: CartItemForHash = {
      id: "item-val",
      quantity: 2,
      unit_price: { amount: 1500 },
    };
    // Both should produce the same hash because the resolved price is the same
    expect(hashCart([itemWithValue])).toBe(hashCart([itemWithUnitPrice]));
  });

  it("treats missing price fields as 0", () => {
    const noPriceItem: CartItemForHash = { id: "item-x", quantity: 1 };
    const zeroPriceItem: CartItemForHash = {
      id: "item-x",
      quantity: 1,
      unit_price: { amount: 0 },
    };
    expect(hashCart([noPriceItem])).toBe(hashCart([zeroPriceItem]));
  });

  it("unit_price takes precedence over value when both present", () => {
    const itemBothFields: CartItemForHash = {
      id: "item-both",
      quantity: 1,
      unit_price: { amount: 100 },
      value: { amount: 999 },
    };
    const itemUnitPriceOnly: CartItemForHash = {
      id: "item-both",
      quantity: 1,
      unit_price: { amount: 100 },
    };
    // ?? evaluation: unit_price.amount (100) is used, not value.amount (999)
    expect(hashCart([itemBothFields])).toBe(hashCart([itemUnitPriceOnly]));
  });
});
