/**
 * Unit tests for the formatValue primitive and the isPresent presence helper.
 * Pure functions — no React or @plasmicapp/host involved. Locale is passed
 * explicitly so assertions are deterministic across machines.
 */
import {
  DEFAULT_LOCALE,
  extractRawExtensions,
  formatValue,
  isPresent,
} from "../format";

describe("extractRawExtensions", () => {
  it("reads the EP wire path off a product's rawData", () => {
    const extensions = { "products(x)": { a: 1 } };
    expect(
      extractRawExtensions({
        rawData: { data: { attributes: { extensions } } },
      }),
    ).toBe(extensions);
  });

  it("is fail-soft for missing rawData / attributes / extensions", () => {
    expect(extractRawExtensions(undefined)).toBeNull();
    expect(extractRawExtensions({})).toBeNull();
    expect(extractRawExtensions({ rawData: { data: {} } })).toBeNull();
  });
});

describe("isPresent", () => {
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["whitespace-only string", "   ", false],
    ["empty array", [], false],
    ["empty object", {}, false],
    ["non-empty string", "x", true],
    ["zero", 0, true],
    ["false", false, true],
    ["non-empty array", [1], true],
    ["non-empty object", { a: 1 }, true],
  ])("treats %s as %s", (_label, value, expected) => {
    expect(isPresent(value)).toBe(expected);
  });
});

describe("formatValue", () => {
  it("returns empty string for null/undefined regardless of format", () => {
    expect(formatValue(null, "currency", "en-US", "USD")).toBe("");
    expect(formatValue(undefined, "text")).toBe("");
  });

  describe("currency", () => {
    it("formats a number with the supplied currency code", () => {
      expect(formatValue(135, "currency", "en-US", "CHF")).toBe(
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "CHF",
        }).format(135),
      );
    });

    it("is locale-deterministic", () => {
      const value = formatValue(1234.5, "currency", "de-DE", "EUR");
      expect(value).toBe(
        new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
        }).format(1234.5),
      );
    });

    it("coerces a numeric string", () => {
      expect(formatValue("99", "currency", "en-US", "USD")).toBe(
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(99),
      );
    });

    it("falls back to a plain number when no currency code is given", () => {
      expect(formatValue(135, "currency", "en-US")).toBe(
        new Intl.NumberFormat("en-US").format(135),
      );
    });

    it("falls back to humane text for a non-numeric value", () => {
      expect(formatValue("free", "currency", "en-US", "USD")).toBe("free");
    });
  });

  describe("number", () => {
    it("groups via Intl for the locale", () => {
      expect(formatValue(1234567, "number", "en-US")).toBe(
        new Intl.NumberFormat("en-US").format(1234567),
      );
    });

    it("coerces a numeric string", () => {
      expect(formatValue("42", "number", "en-US")).toBe(
        new Intl.NumberFormat("en-US").format(42),
      );
    });
  });

  describe("date", () => {
    it("formats an ISO date string via Intl", () => {
      const iso = "2026-06-02T00:00:00.000Z";
      expect(formatValue(iso, "date", "en-US")).toBe(
        new Intl.DateTimeFormat("en-US").format(new Date(iso)),
      );
    });

    it("falls back to humane text for an unparseable value", () => {
      expect(formatValue("not a date", "date", "en-US")).toBe("not a date");
    });
  });

  describe("raw", () => {
    it("returns strings unchanged", () => {
      expect(formatValue("CHF 135", "raw")).toBe("CHF 135");
    });

    it("stringifies numbers and booleans without locale grouping", () => {
      expect(formatValue(1234567, "raw")).toBe("1234567");
      expect(formatValue(true, "raw")).toBe("true");
    });

    it("JSON-encodes arrays and objects", () => {
      expect(formatValue([{ code: "x" }], "raw")).toBe('[{"code":"x"}]');
    });
  });

  describe("text", () => {
    it("uses the humane renderer (Yes/No, comma-joined arrays)", () => {
      expect(formatValue(true, "text")).toBe("Yes");
      expect(formatValue(["red", "green"], "text")).toBe("red, green");
    });
  });

  describe("auto inference", () => {
    it("renders booleans as Yes/No", () => {
      expect(formatValue(true, "auto")).toBe("Yes");
      expect(formatValue(false, "auto")).toBe("No");
    });

    it("groups numbers via Intl for the default locale", () => {
      expect(formatValue(1299, "auto")).toBe(
        new Intl.NumberFormat(DEFAULT_LOCALE).format(1299),
      );
    });

    it("passes strings through and humanizes complex values", () => {
      expect(formatValue("Organic cotton", "auto")).toBe("Organic cotton");
      expect(formatValue(["a", "b"], "auto")).toBe("a, b");
      expect(formatValue({ width_cm: 30 }, "auto")).toBe("Width Cm: 30");
    });
  });
});
