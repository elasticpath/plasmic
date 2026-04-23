import { parseProjectIds } from "./ep-rate-limit";

describe("parseProjectIds", () => {
  it("parses a single project token", () => {
    expect(parseProjectIds("abc123:secrettoken")).toEqual(["abc123"]);
  });

  it("parses multiple project tokens", () => {
    expect(parseProjectIds("abc123:token1,def456:token2,ghi789:token3")).toEqual(
      ["abc123", "def456", "ghi789"]
    );
  });

  it("trims whitespace around entries", () => {
    expect(parseProjectIds(" abc123:token1 , def456:token2 ")).toEqual([
      "abc123",
      "def456",
    ]);
  });

  it("returns empty array for undefined header", () => {
    expect(parseProjectIds(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseProjectIds("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseProjectIds("   ")).toEqual([]);
  });

  it("filters out entries with no project id", () => {
    expect(parseProjectIds(":token1,abc123:token2")).toEqual(["abc123"]);
  });

  it("handles entry with no token part", () => {
    // projectId is present even if token is missing — we only extract the id
    expect(parseProjectIds("abc123:,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("handles entry with no colon separator", () => {
    // no colon means split gives one part — treated as projectId with no token
    expect(parseProjectIds("abc123,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("preserves duplicate project ids", () => {
    // deduplication is not the responsibility of the parser
    expect(parseProjectIds("abc123:token1,abc123:token2")).toEqual([
      "abc123",
      "abc123",
    ]);
  });
});
