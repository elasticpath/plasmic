import { registerEpCustomFunctions } from "../register-custom-functions";
import { epGetProduct } from "../getProduct";
import { epGetCart } from "../getCart";
import { epGetProductList } from "../getProductList";
import { epGetRelatedProducts } from "../getRelatedProducts";

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
    expect(fn).toBe(epGetProduct);
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
    ["getProduct", () => epGetProduct],
    ["getCart", () => epGetCart],
    ["getProductList", () => epGetProductList],
    ["getRelatedProducts", () => epGetRelatedProducts],
  ])("registers ep.%s", (fnName, getFn) => {
    const registerFunction = jest.fn();
    const fakeLoader = { registerFunction };

    registerEpCustomFunctions(fakeLoader as any);

    const call = registerFunction.mock.calls.find(
      (args) => args[1]?.name === fnName
    );
    expect(call).toBeDefined();
    expect(call![0]).toBe(getFn());
    expect(call![1].namespace).toBe("ep");
    expect(call![1].importPath).toBe(
      "@elasticpath/plasmic-ep-commerce-elastic-path/server"
    );
  });
});
