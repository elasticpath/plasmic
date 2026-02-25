jest.mock("../cookies", () => ({
  getCookies: jest.fn(),
  setCookies: jest.fn(),
  removeCookies: jest.fn(),
}));

jest.mock("../../const", () => ({
  ELASTICPATH_CART_COOKIE: "ep_cart",
}));

const { getCookies, setCookies, removeCookies } = require("../cookies") as {
  getCookies: jest.Mock;
  setCookies: jest.Mock;
  removeCookies: jest.Mock;
};

const { getCartId, setCartId, removeCartCookie } = require("../cart-cookie") as {
  getCartId: () => string | undefined;
  setCartId: (id: string) => void;
  removeCartCookie: () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getCartId", () => {
  it("calls getCookies with ELASTICPATH_CART_COOKIE", () => {
    getCartId();
    expect(getCookies).toHaveBeenCalledWith("ep_cart");
  });

  it("returns the value from getCookies when a cart id exists", () => {
    getCookies.mockReturnValue("cart_abc123");
    const result = getCartId();
    expect(result).toBe("cart_abc123");
  });

  it("returns undefined when no cart cookie is set", () => {
    getCookies.mockReturnValue(undefined);
    const result = getCartId();
    expect(result).toBeUndefined();
  });
});

describe("setCartId", () => {
  it("calls setCookies with the cart cookie name and the given id", () => {
    setCartId("cart_xyz789");
    expect(setCookies).toHaveBeenCalledWith("ep_cart", "cart_xyz789");
  });

  it("passes the id value without modification", () => {
    setCartId("");
    expect(setCookies).toHaveBeenCalledWith("ep_cart", "");
  });

  it("is called exactly once per invocation", () => {
    setCartId("cart_once");
    expect(setCookies).toHaveBeenCalledTimes(1);
  });
});

describe("removeCartCookie", () => {
  it("calls removeCookies with the cart cookie name", () => {
    removeCartCookie();
    expect(removeCookies).toHaveBeenCalledWith("ep_cart");
  });

  it("calls removeCookies exactly once", () => {
    removeCartCookie();
    expect(removeCookies).toHaveBeenCalledTimes(1);
  });
});
