import {
  getDropdownOptions,
  getQuantityMode,
  parseQuantityInput,
} from "../quantity-select";

describe("getQuantityMode", () => {
  it("shows the dropdown below the threshold", () => {
    expect(getQuantityMode(1, 5)).toBe("dropdown");
    expect(getQuantityMode(4, 5)).toBe("dropdown");
  });

  it("switches to the input at and above the threshold", () => {
    expect(getQuantityMode(5, 5)).toBe("input");
    expect(getQuantityMode(42, 5)).toBe("input");
  });
});

describe("getDropdownOptions", () => {
  it("lists 1..4 then a terminal 5+ (min=1, threshold=5)", () => {
    expect(getDropdownOptions(5)).toEqual([
      { value: 1, label: "1", isOverflow: false },
      { value: 2, label: "2", isOverflow: false },
      { value: 3, label: "3", isOverflow: false },
      { value: 4, label: "4", isOverflow: false },
      { value: 5, label: "5+", isOverflow: true },
    ]);
  });

  it("honours a custom minimum", () => {
    expect(getDropdownOptions(4, 2)).toEqual([
      { value: 2, label: "2", isOverflow: false },
      { value: 3, label: "3", isOverflow: false },
      { value: 4, label: "4+", isOverflow: true },
    ]);
  });

  it("yields only the overflow option when min equals threshold", () => {
    expect(getDropdownOptions(1, 1)).toEqual([
      { value: 1, label: "1+", isOverflow: true },
    ]);
  });

  it("marks exactly one overflow option", () => {
    const overflow = getDropdownOptions(5).filter((o) => o.isOverflow);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].value).toBe(5);
  });
});

describe("parseQuantityInput", () => {
  it("parses a valid integer string", () => {
    expect(parseQuantityInput("7", 1, 99)).toBe(7);
  });

  it("clamps below the minimum", () => {
    expect(parseQuantityInput("0", 1, 99)).toBe(1);
    expect(parseQuantityInput("-3", 1, 99)).toBe(1);
  });

  it("clamps above the maximum", () => {
    expect(parseQuantityInput("250", 1, 99)).toBe(99);
  });

  it("falls back to the minimum for empty or non-numeric input", () => {
    expect(parseQuantityInput("", 1, 99)).toBe(1);
    expect(parseQuantityInput("   ", 1, 99)).toBe(1);
    expect(parseQuantityInput("abc", 1, 99)).toBe(1);
  });

  it("truncates fractional values", () => {
    expect(parseQuantityInput("3.9", 1, 99)).toBe(3);
    expect(parseQuantityInput(4.2, 1, 99)).toBe(4);
  });

  it("accepts a numeric argument", () => {
    expect(parseQuantityInput(12, 1, 99)).toBe(12);
  });
});
