import { formatOptionValues } from "../option-values";

describe("formatOptionValues", () => {
  it("joins values only, in order, with the default ' / ' separator", () => {
    expect(
      formatOptionValues([
        { name: "Color", value: "Blue" },
        { name: "Size", value: "Large" },
      ])
    ).toBe("Blue / Large");
  });

  it("preserves option order", () => {
    expect(
      formatOptionValues([
        { name: "Language", value: "English" },
        { name: "Format", value: "PDF + ePub" },
      ])
    ).toBe("English / PDF + ePub");
  });

  it("renders a single option as just its value", () => {
    expect(formatOptionValues([{ name: "Size", value: "32" }])).toBe("32");
  });

  it("returns an empty string for an empty array", () => {
    expect(formatOptionValues([])).toBe("");
  });

  it("returns an empty string for undefined/null input (no stray separators)", () => {
    expect(formatOptionValues(undefined)).toBe("");
    expect(formatOptionValues(null)).toBe("");
  });

  it("skips options with an empty value", () => {
    expect(
      formatOptionValues([
        { name: "Color", value: "Blue" },
        { name: "Size", value: "" },
      ])
    ).toBe("Blue");
  });

  it("honours a custom separator", () => {
    expect(
      formatOptionValues(
        [
          { name: "Color", value: "Blue" },
          { name: "Size", value: "Large" },
        ],
        " · "
      )
    ).toBe("Blue · Large");
  });
});
