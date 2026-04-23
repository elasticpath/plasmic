import { parseTokenIds } from "./ep-rate-limit";

describe("parseTokenIds", () => {
  it("parses a single project token", () => {
    expect(parseTokenIds("abc123:secrettoken")).toEqual(["abc123"]);
  });

  it("parses multiple project tokens", () => {
    expect(parseTokenIds("abc123:token1,def456:token2,ghi789:token3")).toEqual(
      ["abc123", "def456", "ghi789"]
    );
  });

  it("trims whitespace around entries", () => {
    expect(parseTokenIds(" abc123:token1 , def456:token2 ")).toEqual([
      "abc123",
      "def456",
    ]);
  });

  it("returns empty array for undefined header", () => {
    expect(parseTokenIds(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTokenIds("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseTokenIds("   ")).toEqual([]);
  });

  it("filters out entries with no project id", () => {
    expect(parseTokenIds(":token1,abc123:token2")).toEqual(["abc123"]);
  });

  it("handles entry with no token part", () => {
    // projectId is present even if token is missing — we only extract the id
    expect(parseTokenIds("abc123:,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("handles entry with no colon separator", () => {
    // no colon means split gives one part — treated as projectId with no token
    expect(parseTokenIds("abc123,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("preserves duplicate project ids", () => {
    // deduplication is not the responsibility of the parser
    expect(parseTokenIds("abc123:token1,abc123:token2")).toEqual([
      "abc123",
      "abc123",
    ]);
  });
});
