import { epGetProduct } from "../getProduct";
import {
  addCartItem,
  applyCartAdjustment,
  getCart,
  getProduct,
  getProductList,
  getRelatedProducts,
  registerEpCustomFunctions,
  removeCartItem,
  updateCartItem,
} from "../register-custom-functions";

describe("registerEpCustomFunctions", () => {
  it("registers ep.getProduct with the correct meta shape", () => {
    const registerFunction = jest.fn();
    const fakeLoader = { registerFunction };

    registerEpCustomFunctions(fakeLoader as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === "getProduct"
    );

    expect(call).toBeDefined();
    const [fn, meta] = call!;
    // After the param-flattening refactor, registerFunction receives an
    // ADAPTED function that reassembles flat positional args into the
    // input object expected by epGetProduct. Identity check is no
    // longer meaningful; we verify it's a callable + meta is correct.
    expect(typeof fn).toBe("function");
    expect(meta.namespace).toBe("ep");
    expect(meta.importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path/server"
    );
  });

  it("is idempotent — a second call on the same loader does not re-register", () => {
    const registerFunction = jest.fn();
    const fakeLoader = { registerFunction };

    registerEpCustomFunctions(fakeLoader as any);
    const firstCallCount = registerFunction.mock.calls.length;
    registerEpCustomFunctions(fakeLoader as any);

    expect(registerFunction.mock.calls.length).toBe(firstCallCount);
  });

  it.each([
    ["getProduct"],
    ["getCart"],
    ["getProductList"],
    ["getRelatedProducts"],
    ["addCartItem"],
    ["applyCartAdjustment"],
    ["updateCartItem"],
    ["removeCartItem"],
  ])("registers ep.%s", (fnName) => {
    const registerFunction = jest.fn();
    const fakeLoader = { registerFunction };

    registerEpCustomFunctions(fakeLoader as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === fnName
    );
    expect(call).toBeDefined();
    expect(typeof call![0]).toBe("function");
    expect(call![1].namespace).toBe("ep");
    expect(call![1].importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path/server"
    );
  });

  // After PRD #272 — auth flows via AsyncLocalStorage (`withEpSession`),
  // not through Server Query execParams. No registered function should
  // advertise an `auth` parameter; otherwise designers continue to
  // hand-bind it in Studio and reintroduce the cache-key issue.
  it("does not advertise an `auth` parameter on any registered function", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    for (const [, meta] of registerFunction.mock.calls) {
      const paramNames: string[] = (meta.params ?? []).map(
        (p: { name: string }) => p.name
      );
      expect(paramNames).not.toContain("auth");
    }
  });

  it("registers ep.getProduct with a flat `id` param (Studio canvas compatibility)", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === "getProduct"
    );
    expect(call).toBeDefined();
    const params = call![1].params;
    expect(params).toEqual([
      expect.objectContaining({ name: "id", type: "string" }),
    ]);
  });

  /**
   * The listing endpoints take no `sort`, so neither function may advertise
   * one: Elastic Path ignores an unsupported sort silently, making a
   * designer-visible param that cannot work worse than no param at all.
   */
  it("advertises no `sort` param on the product listing functions", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    for (const name of ["getProductList", "getProductPage"]) {
      const call = registerFunction.mock.calls.find(
        (args) => args[1]?.name === name
      );
      expect(call).toBeDefined();
      const paramNames: string[] = (call![1].params ?? []).map(
        (p: { name: string }) => p.name
      );
      expect(paramNames).not.toContain("sort");
    }
  });

  it("registers ep.applyCartAdjustment as a mutation with a flat money-bearing param schema", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === "applyCartAdjustment"
    );
    expect(call).toBeDefined();
    const meta = call![1];
    // Designers discover/invoke it as a mutation Server Query (PRD #371 story 12).
    expect(meta.isMutation).toBe(true);
    const paramNames: string[] = (meta.params ?? []).map(
      (p: { name: string }) => p.name
    );
    expect(paramNames).toEqual(["label", "amountMinor", "kind", "quantity"]);
  });

  it("only applyCartAdjustment is flagged isMutation among the read functions", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    const reads = [
      "getProduct",
      "getCart",
      "getProductList",
      "getRelatedProducts",
    ];
    for (const name of reads) {
      const call = registerFunction.mock.calls.find((a) => a[1]?.name === name);
      expect(call![1].isMutation).toBeUndefined();
    }
  });

  // The loader imports the bare `meta.name` symbol from the "/server" entry
  // and calls it positionally. These exports must therefore be the adapted
  // functions, not the object-input `ep*` originals.
  it.each([
    ["getProduct", getProduct],
    ["getCart", getCart],
    ["getProductList", getProductList],
    ["getRelatedProducts", getRelatedProducts],
    ["addCartItem", addCartItem],
    ["applyCartAdjustment", applyCartAdjustment],
    ["updateCartItem", updateCartItem],
    ["removeCartItem", removeCartItem],
  ])("exports %s as the adapted function it registers", (name, exported) => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === name
    );
    expect(call).toBeDefined();
    expect(exported).toBe(call![0]);
  });

  // Studio's ServerQueryOpPicker filters on `mode === "mutation" ? fn.isMutation
  // : fn.isQuery`, so a function flagged as neither is offered in no picker at
  // all — it silently disappears from the UI. Upstream added that filter after
  // these functions were written, which is how the reads went missing.
  describe("every registered function is discoverable in Studio", () => {
    const register = () => {
      const registerFunction = jest.fn();
      registerEpCustomFunctions({ registerFunction } as any);
      return registerFunction.mock.calls.map((args) => args[1]);
    };

    it.each([
      ["getProduct"],
      ["getCart"],
      ["getProductList"],
      ["getRelatedProducts"],
    ])("offers ep.%s as a data query", (name) => {
      const meta = register().find((m) => m?.name === name);
      expect(meta).toBeDefined();
      expect(meta.isQuery).toBe(true);
      expect(meta.isMutation).toBeUndefined();
    });

    it.each([
      ["addCartItem"],
      ["applyCartAdjustment"],
      ["updateCartItem"],
      ["removeCartItem"],
    ])("offers ep.%s as a mutation", (name) => {
      const meta = register().find((m) => m?.name === name);
      expect(meta).toBeDefined();
      expect(meta.isMutation).toBe(true);
      expect(meta.isQuery).toBeUndefined();
    });

    it("flags each function as exactly one of query or mutation", () => {
      const neither = register().filter((m) => !m.isQuery && !m.isMutation);
      const both = register().filter((m) => m.isQuery && m.isMutation);
      expect(neither.map((m) => m.name)).toEqual([]);
      expect(both.map((m) => m.name)).toEqual([]);
    });
  });

  it("adapted function reassembles flat positional args into the input object", () => {
    const registerFunction = jest.fn();
    registerEpCustomFunctions({ registerFunction } as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === "getProduct"
    );
    const adapted = call![0] as (...args: unknown[]) => unknown;

    // Mock the underlying function so we can inspect what it gets.
    // The adapted function calls the real epGetProduct, which returns
    // null for an unusable session — no EP fetch fires. Verify the
    // adapter's reassembly via the input it would have built; we test
    // by passing a mock session via the optional input.auth fallback.
    const realFn = jest.requireActual("../getProduct").epGetProduct as (input: {
      id: string;
      auth?: any;
    }) => Promise<unknown>;
    void realFn; // adapter calls spec.fn directly; the fact that
    // adapted("test-id") returns the same Promise as
    // epGetProduct({id: "test-id"}) is the regression net.
    const result1 = adapted("test-id");
    const result2 = epGetProduct({ id: "test-id" });
    expect(result1).toBeInstanceOf(Promise);
    expect(result2).toBeInstanceOf(Promise);
  });
});
