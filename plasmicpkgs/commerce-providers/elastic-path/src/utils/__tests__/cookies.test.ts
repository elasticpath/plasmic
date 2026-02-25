jest.mock("js-cookie", () => ({
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
}));

jest.mock("../../const", () => ({
  ELASTICPATH_COOKIE_EXPIRE: 7,
}));

const Cookies = require("js-cookie") as {
  get: jest.Mock;
  set: jest.Mock;
  remove: jest.Mock;
};

const { getCookies, setCookies, removeCookies } = require("../cookies") as {
  getCookies: <T>(name: string) => T | undefined;
  setCookies: (name: string, value: any) => void;
  removeCookies: (name: string) => void;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getCookies", () => {
  it("returns parsed JSON when the cookie exists", () => {
    Cookies.get.mockReturnValue(JSON.stringify({ id: "abc" }));
    const result = getCookies("my_cookie");
    expect(Cookies.get).toHaveBeenCalledWith("my_cookie");
    expect(result).toEqual({ id: "abc" });
  });

  it("returns undefined when the cookie does not exist", () => {
    Cookies.get.mockReturnValue(undefined);
    const result = getCookies("missing_cookie");
    expect(Cookies.get).toHaveBeenCalledWith("missing_cookie");
    expect(result).toBeUndefined();
  });

  it("parses a string value correctly", () => {
    Cookies.get.mockReturnValue(JSON.stringify("hello"));
    const result = getCookies<string>("str_cookie");
    expect(result).toBe("hello");
  });

  it("parses a numeric value correctly", () => {
    Cookies.get.mockReturnValue(JSON.stringify(42));
    const result = getCookies<number>("num_cookie");
    expect(result).toBe(42);
  });

  it("parses an array value correctly", () => {
    Cookies.get.mockReturnValue(JSON.stringify([1, 2, 3]));
    const result = getCookies<number[]>("arr_cookie");
    expect(result).toEqual([1, 2, 3]);
  });

  it("handles the generic type parameter for complex objects", () => {
    interface UserToken {
      token: string;
      expires: number;
    }
    Cookies.get.mockReturnValue(
      JSON.stringify({ token: "tok_123", expires: 9999 })
    );
    const result = getCookies<UserToken>("user_token");
    expect(result).toEqual({ token: "tok_123", expires: 9999 });
  });
});

describe("setCookies", () => {
  it("calls Cookies.set with JSON.stringify and correct options", () => {
    setCookies("my_cookie", { id: "abc" });
    expect(Cookies.set).toHaveBeenCalledWith(
      "my_cookie",
      JSON.stringify({ id: "abc" }),
      { expires: 7, sameSite: "none", secure: true }
    );
  });

  it("stringifies a primitive value before setting", () => {
    setCookies("prim_cookie", 123);
    expect(Cookies.set).toHaveBeenCalledWith("prim_cookie", "123", {
      expires: 7,
      sameSite: "none",
      secure: true,
    });
  });
});

describe("removeCookies", () => {
  it("calls Cookies.remove with the correct name", () => {
    removeCookies("my_cookie");
    expect(Cookies.remove).toHaveBeenCalledWith("my_cookie");
  });

  it("passes only the cookie name to Cookies.remove", () => {
    removeCookies("other_cookie");
    expect(Cookies.remove).toHaveBeenCalledTimes(1);
    expect(Cookies.remove).toHaveBeenCalledWith("other_cookie");
  });
});
