/**
 * Tests for getLocalizedString utility.
 *
 * Why: EP product attributes can have localized values keyed by locale code
 * (e.g., { "en-US": "Shirt", "fr-FR": "Chemise" }). This function extracts
 * the correct string for the current locale, falls back to the first value
 * when the locale doesn't match, and returns undefined when data is missing.
 * Incorrect behavior silently shows wrong-language content to customers.
 */

import getLocalizedString from "../localized-string";

describe("getLocalizedString", () => {
  const localizedStrings = {
    "en-US": "Shirt",
    "fr-FR": "Chemise",
    "de-DE": "Hemd",
  };

  it("returns the string for the matching locale", () => {
    expect(getLocalizedString(localizedStrings, "en-US")).toBe("Shirt");
  });

  it("returns correct value for non-English locale", () => {
    expect(getLocalizedString(localizedStrings, "fr-FR")).toBe("Chemise");
  });

  it("falls back to first value when locale is not found", () => {
    expect(getLocalizedString(localizedStrings, "ja-JP")).toBe("Shirt");
  });

  it("returns undefined when localizedString is undefined", () => {
    expect(getLocalizedString(undefined, "en-US")).toBeUndefined();
  });

  it("returns undefined when locale is undefined", () => {
    expect(getLocalizedString(localizedStrings, undefined)).toBeUndefined();
  });

  it("returns undefined when both arguments are undefined", () => {
    expect(getLocalizedString(undefined, undefined)).toBeUndefined();
  });

  it("handles single-entry localized strings", () => {
    expect(getLocalizedString({ "en-US": "Only English" }, "en-US")).toBe(
      "Only English"
    );
  });

  it("handles empty record by returning undefined for any locale", () => {
    // Object.values({}) returns [] and [0] is undefined
    expect(getLocalizedString({}, "en-US")).toBeUndefined();
  });
});
