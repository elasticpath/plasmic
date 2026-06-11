import { filterAllowedCustomAttributes } from "../custom-attributes-allowlist";

describe("filterAllowedCustomAttributes", () => {
  const ATTRS = { industry: "Tech", marketingOptIn: true, kyc_verified: true };

  it("fails closed when no allow-list is configured (undefined)", () => {
    const { allowed, dropped } = filterAllowedCustomAttributes(ATTRS, undefined);
    expect(allowed).toBeUndefined();
    expect(dropped.sort()).toEqual(["industry", "kyc_verified", "marketingOptIn"]);
  });

  it("fails closed for an empty allow-list", () => {
    const { allowed, dropped } = filterAllowedCustomAttributes(ATTRS, []);
    expect(allowed).toBeUndefined();
    expect(dropped).toHaveLength(3);
  });

  it("keeps only allow-listed keys and reports the rest as dropped", () => {
    const { allowed, dropped } = filterAllowedCustomAttributes(ATTRS, [
      "industry",
      "marketingOptIn",
    ]);
    expect(allowed).toEqual({ industry: "Tech", marketingOptIn: true });
    expect(dropped).toEqual(["kyc_verified"]);
  });

  it('passes everything through for the "*" sentinel', () => {
    const { allowed, dropped } = filterAllowedCustomAttributes(ATTRS, "*");
    expect(allowed).toBe(ATTRS); // same reference — no copy needed
    expect(dropped).toEqual([]);
  });

  it("returns undefined allowed (not {}) when every key is dropped", () => {
    const { allowed } = filterAllowedCustomAttributes(ATTRS, ["not-present"]);
    expect(allowed).toBeUndefined();
  });

  it("is a no-op for empty / absent input", () => {
    expect(filterAllowedCustomAttributes(undefined, ["industry"])).toEqual({
      allowed: undefined,
      dropped: [],
    });
    expect(filterAllowedCustomAttributes({}, "*")).toEqual({
      allowed: undefined,
      dropped: [],
    });
  });

  it("preserves boolean/number/string value types for kept keys", () => {
    const { allowed } = filterAllowedCustomAttributes(
      { s: "x", n: 7, b: false },
      ["s", "n", "b"]
    );
    expect(allowed).toEqual({ s: "x", n: 7, b: false });
  });
});
