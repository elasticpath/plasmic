import { buildExtensionsMap } from "../extensions-map";
import type { ExtensionTemplate } from "../../types/extensions";

const templates: ExtensionTemplate[] = [
  {
    slug: "products(iso-standard)",
    label: "Iso Standard",
    fieldCount: 2,
    fields: [
      {
        key: "reference",
        label: "Reference",
        value: "ISO 5495:2005",
        type: "string",
        displayValue: "ISO 5495:2005",
      },
      {
        key: "edition",
        label: "Edition",
        value: 3,
        type: "number",
        displayValue: "3",
      },
    ],
  },
];

describe("buildExtensionsMap", () => {
  it("keys by the raw slug and exposes raw values", () => {
    const m = buildExtensionsMap(templates);
    expect(m["products(iso-standard)"].reference).toBe("ISO 5495:2005");
    expect(m["products(iso-standard)"].edition).toBe(3); // raw number, not "3"
  });

  it("returns a frozen {} for an absent slug (never throws)", () => {
    const m = buildExtensionsMap(templates);
    expect(m["products(nope)"]).toEqual({});
    expect(() => (m["products(nope)"] as Record<string, unknown>).x).not.toThrow();
    expect((m["products(nope)"] as Record<string, unknown>).x).toBeUndefined();
  });

  it("returns undefined for an absent field on a present slug", () => {
    const m = buildExtensionsMap(templates);
    expect((m["products(iso-standard)"] as Record<string, unknown>).nope).toBeUndefined();
  });

  it("exposes real slugs via Object.keys (data-picker discovery)", () => {
    expect(Object.keys(buildExtensionsMap(templates))).toEqual([
      "products(iso-standard)",
    ]);
  });

  it("handles no templates — every slug is {}", () => {
    const m = buildExtensionsMap([]);
    expect(m["products(iso-standard)"]).toEqual({});
  });
});
