/**
 * normalizeSearchHit — shared base Product contract + tiered surface (ADR-0011).
 */

import {
  normalizeSearchHit,
  DEFAULT_PRODUCT_PATH_PREFIX,
} from "../normalize-hit";

describe("normalizeSearchHit — base Product contract (D7)", () => {
  it("produces the shared base Product fields from EP field-name conventions", () => {
    const { product } = normalizeSearchHit(
      {
        objectID: "p1",
        attributes: {
          name: "Leather Bag",
          slug: "leather-bag",
          sku: "LB-1",
          description: "A bag.",
        },
        main_image: { link: { href: "https://img/x.png" } },
        meta: {
          display_price: {
            without_tax: { float_price: 12.5, currency: "USD" },
          },
        },
      },
      "USD"
    );

    expect(product.id).toBe("p1");
    expect(product.name).toBe("Leather Bag");
    expect(product.slug).toBe("leather-bag");
    expect(product.sku).toBe("LB-1");
    expect(product.description).toBe("A bag.");
    expect(product.path).toBe(`${DEFAULT_PRODUCT_PATH_PREFIX}/leather-bag`);
    expect(product.images[0].url).toBe("https://img/x.png");
    expect(product.price.value).toBe(12.5);
    expect(product.price.currencyCode).toBe("USD");
    // base contract shape parity with the PDP normalizer
    expect(product.variants).toEqual([]);
    expect(product.options).toEqual([]);
  });

  it("a base field absent from a hit reads as absent (presence false), never throws", () => {
    const { product } = normalizeSearchHit({ objectID: "p2" }, "USD");
    // empty strings are the honest base-contract value; isPresent() reads them
    // as absent, so a presence-gated field component renders nothing.
    expect(product.name).toBe("");
    expect(product.description).toBe("");
    expect(product.slug).toBe("");
    // never throws building the path even with no slug
    expect(product.path).toBe(`${DEFAULT_PRODUCT_PATH_PREFIX}/p2`);
  });

  it("typed search superset rides along on the product", () => {
    const { product } = normalizeSearchHit(
      {
        objectID: "p3",
        _rawTypesenseHit: {
          highlight: {
            name: { value: "<mark>Leather</mark> Bag" },
            description: { snippet: "a <mark>leather</mark> tote" },
          },
        },
        _score: 0.92,
      },
      "USD"
    );
    expect(product._highlightedName).toBe("<mark>Leather</mark> Bag");
    expect(product._snippetedDescription).toBe("a <mark>leather</mark> tote");
    expect(product._score).toBe(0.92);
    expect(product._rawTypesenseHit).toBeTruthy();
    expect(product.rawHit.objectID).toBe("p3");
  });
});

describe("normalizeSearchHit — tiered extension surface (D1)", () => {
  const hit = {
    objectID: "p4",
    attributes: {
      name: "Standard 9001",
      extensions: {
        "products(iso-standard)": {
          title: "Quality management",
          product_kind: "publication",
        },
      },
    },
  };

  it("Tier 2: publishes a null-safe slug-keyed extensions map (absent slug → {})", () => {
    const { extensionsMap } = normalizeSearchHit(hit, "USD");
    expect(extensionsMap["products(iso-standard)"].title).toBe(
      "Quality management"
    );
    // absent slug never throws (the buildExtensionsMap Proxy)
    expect(extensionsMap["products(nope)"].whatever).toBeUndefined();
  });

  it("Tier 1: flattens the primaryExtensionTemplate onto currentProduct.fields", () => {
    const { product } = normalizeSearchHit(hit, "USD", {
      primaryExtensionTemplate: "products(iso-standard)",
    });
    expect(product.fields.title).toBe("Quality management");
    expect(product.fields.product_kind).toBe("publication");
    // a missing key on a present template reads undefined, never throws
    expect((product.fields as Record<string, unknown>).missing).toBeUndefined();
  });

  it("fields is an empty object when primaryExtensionTemplate is unset or absent", () => {
    expect(normalizeSearchHit(hit, "USD").product.fields).toEqual({});
    expect(
      normalizeSearchHit(hit, "USD", {
        primaryExtensionTemplate: "products(not-here)",
      }).product.fields
    ).toEqual({});
  });

  it("Tier 3: retains the raw extensions block", () => {
    const { product } = normalizeSearchHit(hit, "USD");
    expect(product.extensions).toEqual(hit.attributes.extensions);
  });
});
