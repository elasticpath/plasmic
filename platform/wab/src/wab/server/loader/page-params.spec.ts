import { BadRequestError } from "@/wab/shared/ApiErrors/errors";
import {
  getInvalidParamKeys,
  isValidParamsObject,
  isValidParamValue,
  isValidRoutePattern,
  parsePageParams,
  parsePageQuery,
  parsePageRoute,
} from "./page-params";

describe("page-params", () => {
  describe("isValidRoutePattern", () => {
    it("returns true for valid route patterns", () => {
      expect(isValidRoutePattern("/")).toBe(true);
      expect(isValidRoutePattern("/products")).toBe(true);
      expect(isValidRoutePattern("/products/[slug]")).toBe(true);
      expect(isValidRoutePattern("/products/[...catchall]")).toBe(true);
      expect(isValidRoutePattern("/a/b/c/[id]")).toBe(true);
    });

    it("returns false for invalid route patterns", () => {
      expect(isValidRoutePattern("")).toBe(false);
      expect(isValidRoutePattern("products")).toBe(false);
      expect(isValidRoutePattern("products/[slug]")).toBe(false);
    });
  });

  describe("isValidParamValue", () => {
    it("returns true for valid param values", () => {
      expect(isValidParamValue("hello")).toBe(true);
      expect(isValidParamValue("")).toBe(true);
      expect(isValidParamValue([])).toBe(true);
      expect(isValidParamValue(["a", "b", "c"])).toBe(true);
    });

    it("returns false for invalid param values", () => {
      expect(isValidParamValue(123)).toBe(false);
      expect(isValidParamValue(null)).toBe(false);
      expect(isValidParamValue(undefined)).toBe(false);
      expect(isValidParamValue({})).toBe(false);
      expect(isValidParamValue([1, 2, 3])).toBe(false);
      expect(isValidParamValue(["a", 1])).toBe(false);
    });
  });

  describe("isValidParamsObject", () => {
    it("returns true for valid params objects", () => {
      expect(isValidParamsObject({})).toBe(true);
      expect(isValidParamsObject({ slug: "hello" })).toBe(true);
      expect(isValidParamsObject({ slug: "hello", id: "123" })).toBe(true);
      expect(isValidParamsObject({ catchall: ["a", "b"] })).toBe(true);
      expect(isValidParamsObject({ slug: "hello", parts: ["a", "b"] })).toBe(
        true
      );
    });

    it("returns false for invalid params objects", () => {
      expect(isValidParamsObject(null)).toBe(false);
      expect(isValidParamsObject(undefined)).toBe(false);
      expect(isValidParamsObject("string")).toBe(false);
      expect(isValidParamsObject([])).toBe(false);
      expect(isValidParamsObject([{ slug: "hello" }])).toBe(false);
      expect(isValidParamsObject({ slug: 123 })).toBe(false);
      expect(isValidParamsObject({ slug: null })).toBe(false);
    });
  });

  describe("getInvalidParamKeys", () => {
    it("returns empty array for valid params", () => {
      expect(getInvalidParamKeys({})).toEqual([]);
      expect(getInvalidParamKeys({ slug: "hello" })).toEqual([]);
      expect(getInvalidParamKeys({ slug: ["a", "b"] })).toEqual([]);
    });

    it("returns keys with invalid values", () => {
      expect(getInvalidParamKeys({ slug: 123 })).toEqual(["slug"]);
      expect(getInvalidParamKeys({ a: "valid", b: 123, c: null })).toEqual([
        "b",
        "c",
      ]);
    });
  });

  describe("parsePageRoute", () => {
    it("returns undefined for empty/null/undefined input", () => {
      expect(parsePageRoute()).toBeUndefined();
      expect(parsePageRoute(undefined)).toBeUndefined();
      expect(parsePageRoute(null)).toBeUndefined();
      expect(parsePageRoute("")).toBeUndefined();
    });

    it("parses valid route patterns", () => {
      expect(parsePageRoute("/")).toBe("/");
      expect(parsePageRoute("/products")).toBe("/products");
      expect(parsePageRoute("/products/[slug]")).toBe("/products/[slug]");
      expect(parsePageRoute("/[...catchall]")).toBe("/[...catchall]");
    });

    it("throws BadRequestError for non-string input", () => {
      expect(() => parsePageRoute(123)).toThrow(BadRequestError);
      expect(() => parsePageRoute({})).toThrow(BadRequestError);
      expect(() => parsePageRoute([])).toThrow(BadRequestError);
    });

    it("throws BadRequestError for routes not starting with /", () => {
      expect(() => parsePageRoute("products")).toThrow(BadRequestError);
      expect(() => parsePageRoute("products/[slug]")).toThrow(BadRequestError);
    });
  });

  describe("parsePageParams", () => {
    it("returns undefined for empty/null/undefined input", () => {
      expect(parsePageParams()).toBeUndefined();
      expect(parsePageParams(undefined)).toBeUndefined();
      expect(parsePageParams(null)).toBeUndefined();
      expect(parsePageParams("")).toBeUndefined();
    });

    it("parses valid JSON params", () => {
      expect(parsePageParams("{}")).toEqual({});
      expect(parsePageParams('{"slug":"hello"}')).toEqual({ slug: "hello" });
      expect(parsePageParams('{"slug":"hello","id":"123"}')).toEqual({
        slug: "hello",
        id: "123",
      });
      expect(parsePageParams('{"catchall":["a","b","c"]}')).toEqual({
        catchall: ["a", "b", "c"],
      });
    });

    it("throws BadRequestError for non-string input", () => {
      expect(() => parsePageParams(123)).toThrow(BadRequestError);
      expect(() => parsePageParams({})).toThrow(BadRequestError);
    });

    it("throws BadRequestError for invalid JSON", () => {
      expect(() => parsePageParams("{invalid}")).toThrow(BadRequestError);
      expect(() => parsePageParams("not json")).toThrow(BadRequestError);
    });

    it("throws BadRequestError for non-object JSON", () => {
      expect(() => parsePageParams("[]")).toThrow(BadRequestError);
      expect(() => parsePageParams('"string"')).toThrow(BadRequestError);
      expect(() => parsePageParams("123")).toThrow(BadRequestError);
      expect(() => parsePageParams("null")).toThrow(BadRequestError);
    });

    it("throws BadRequestError for invalid param values", () => {
      expect(() => parsePageParams('{"slug":123}')).toThrow(BadRequestError);
      expect(() => parsePageParams('{"slug":null}')).toThrow(BadRequestError);
      expect(() => parsePageParams('{"slug":[1,2,3]}')).toThrow(BadRequestError);
    });

    it("includes invalid key names in error message", () => {
      expect(() => parsePageParams('{"validKey":"ok","badKey":123}')).toThrow(
        /badKey/
      );
    });
  });

  describe("parsePageQuery", () => {
    it("returns undefined for empty/null/undefined input", () => {
      expect(parsePageQuery()).toBeUndefined();
      expect(parsePageQuery(undefined)).toBeUndefined();
      expect(parsePageQuery(null)).toBeUndefined();
      expect(parsePageQuery("")).toBeUndefined();
    });

    it("parses valid JSON query params", () => {
      expect(parsePageQuery("{}")).toEqual({});
      expect(parsePageQuery('{"q":"search"}')).toEqual({ q: "search" });
      expect(parsePageQuery('{"tags":["a","b"]}')).toEqual({
        tags: ["a", "b"],
      });
    });

    it("throws BadRequestError for non-string input", () => {
      expect(() => parsePageQuery(123)).toThrow(BadRequestError);
      expect(() => parsePageQuery({})).toThrow(BadRequestError);
    });

    it("throws BadRequestError for invalid JSON", () => {
      expect(() => parsePageQuery("{invalid}")).toThrow(BadRequestError);
    });

    it("throws BadRequestError for non-object JSON", () => {
      expect(() => parsePageQuery("[]")).toThrow(BadRequestError);
      expect(() => parsePageQuery("null")).toThrow(BadRequestError);
    });

    it("throws BadRequestError for invalid query values", () => {
      expect(() => parsePageQuery('{"page":123}')).toThrow(BadRequestError);
    });
  });
});
