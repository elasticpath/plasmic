import type { ProductData, ProductListData } from "@epcc-sdk/sdks-shopper";
import {
  normalizeProduct,
  normalizeProductFromList,
} from "../utils/normalize";

const simpleProduct: ProductData = {
  data: {
    id: "prod-1",
    type: "product",
    attributes: { name: "Canvas Tote", slug: "canvas-tote", sku: "TOTE-1" },
    meta: {
      display_price: {
        without_tax: { amount: 4999, currency: "USD", formatted: "$49.99" },
      },
    },
  },
};

describe("normalizeProduct", () => {
  it("keeps Elastic Path's formatted price and fills in the decimal it omits", () => {
    const product = normalizeProduct(simpleProduct, "en-US");

    expect(product.meta?.display_price?.without_tax).toEqual({
      amount: 4999,
      currency: "USD",
      formatted: "$49.99",
      float_price: 49.99,
    });
  });

  it("uses the currency's own exponent, so a zero-decimal price is not divided", () => {
    const product = normalizeProduct(
      {
        data: {
          id: "prod-jpy",
          type: "product",
          meta: {
            display_price: {
              without_tax: { amount: 5000, currency: "JPY", formatted: "￥5,000" },
            },
          },
        },
      },
      "ja-JP"
    );

    expect(product.meta?.display_price?.without_tax?.float_price).toBe(5000);
  });

  it("passes Elastic Path's attributes through untouched", () => {
    const product = normalizeProduct(
      {
        data: {
          id: "prod-2",
          type: "product",
          attributes: {
            name: "Wool Scarf",
            sku: "SCARF-1",
            commodity_type: "physical",
            base_product: false,
          },
        },
      },
      "en-US"
    );

    expect(product.attributes).toEqual({
      name: "Wool Scarf",
      sku: "SCARF-1",
      commodity_type: "physical",
      base_product: false,
    });
    expect(product.id).toBe("prod-2");
    expect(product.type).toBe("product");
  });

  it("joins images from the relationships and the included block", () => {
    const product = normalizeProduct(
      {
        data: {
          id: "prod-3",
          type: "product",
          attributes: { name: "Linen Shirt" },
          relationships: {
            main_image: { data: { id: "img-main", type: "main_image" } },
            files: { data: [{ id: "file-2", type: "file" }] },
          },
        },
        included: {
          main_images: [
            { id: "img-main", link: { href: "https://cdn.example/main.jpg" } },
          ],
          files: [{ id: "file-2", link: { href: "https://cdn.example/alt.jpg" } }],
        },
      },
      "en-US"
    );

    expect(product.images).toEqual([
      { url: "https://cdn.example/main.jpg", alt: "Linen Shirt" },
      { url: "https://cdn.example/alt.jpg", alt: "Linen Shirt" },
    ]);
  });

  it("orders variations and their options by the merchandiser's sort order", () => {
    const product = normalizeProduct(
      {
        data: {
          id: "prod-4",
          type: "product",
          meta: {
            variations: [
              {
                id: "var-colour",
                name: "Colour",
                sort_order: 2,
                options: [{ id: "opt-red", name: "Red" }],
              },
              {
                id: "var-size",
                name: "Size",
                sort_order: 1,
                options: [
                  { id: "opt-l", name: "Large", sort_order: 3 },
                  { id: "opt-s", name: "Small", sort_order: 1 },
                  { id: "opt-m", name: "Medium", sort_order: 2 },
                ],
              },
            ],
          },
        },
      },
      "en-US"
    );

    expect(product.variations.map((v) => v.name)).toEqual(["Size", "Colour"]);
    expect(product.variations[0].options.map((o) => o.name)).toEqual([
      "Small",
      "Medium",
      "Large",
    ]);
    expect(product.variations[0].sortOrder).toBe(1);
  });

  const baseProduct: ProductData = {
    data: {
      id: "base-1",
      type: "product",
      attributes: { name: "Merino Jumper", base_product: true },
      meta: {
        variations: [
          {
            id: "var-size",
            name: "Size",
            options: [
              { id: "opt-s", name: "Small" },
              { id: "opt-m", name: "Medium" },
            ],
          },
        ],
        variation_matrix: { "opt-s": "child-s", "opt-m": "child-m" },
      },
    },
  };

  const children: ProductListData = {
    data: [
      {
        id: "child-m",
        type: "product",
        attributes: { name: "Merino Jumper Medium", sku: "MJ-M", status: "live" },
        meta: {
          display_price: {
            without_tax: { amount: 8999, currency: "GBP", formatted: "£89.99" },
          },
        },
      },
      {
        id: "child-s",
        type: "product",
        attributes: { name: "Merino Jumper Small", sku: "MJ-S", status: "live" },
        meta: {
          display_price: {
            without_tax: { amount: 7999, currency: "GBP", formatted: "£79.99" },
          },
        },
      },
    ],
  };

  it("keys each child product to the variation options that select it", () => {
    const product = normalizeProduct(baseProduct, "en-GB", children);

    const small = product.childProducts.find((c) => c.id === "child-s");
    expect(small).toMatchObject({
      name: "Merino Jumper Small",
      sku: "MJ-S",
      optionIds: ["opt-s"],
    });
    expect(small?.price).toEqual({
      amount: 7999,
      currency: "GBP",
      formatted: "£79.99",
      float_price: 79.99,
    });
  });

  it("carries the child's tax-inclusive price through", () => {
    // Discarding with_tax left a tax-inclusive storefront blank the moment a
    // variant was chosen: the projection has no with_tax to publish and
    // correctly refuses to fall back to the parent's.
    const taxed: ProductListData = {
      data: [
        {
          id: "child-m",
          type: "product",
          attributes: { name: "Merino Jumper Medium", sku: "MJ-M", status: "live" },
          meta: {
            display_price: {
              without_tax: { amount: 8999, currency: "GBP", formatted: "£89.99" },
              with_tax: { amount: 10799, currency: "GBP", formatted: "£107.99" },
            },
          },
        },
      ],
    };

    const product = normalizeProduct(baseProduct, "en-GB", taxed);

    expect(product.childProducts[0].priceWithTax).toEqual({
      amount: 10799,
      currency: "GBP",
      formatted: "£107.99",
      float_price: 107.99,
    });
  });

  it("carries each child's own image", () => {
    // The child fetch already asks for main_image and files, but the normalizer
    // discarded them, so the variant projection had nothing but the parent's
    // photo to show.
    const withImages: ProductListData = {
      data: [
        {
          id: "child-m",
          type: "product",
          attributes: { name: "Merino Jumper Medium", sku: "MJ-M", status: "live" },
          relationships: { main_image: { data: { id: "img-m", type: "main_image" } } },
        } as any,
      ],
      included: {
        main_images: [
          { id: "img-m", type: "file", link: { href: "https://cdn.example/m.jpg" } },
        ],
      } as any,
    };

    const product = normalizeProduct(baseProduct, "en-GB", withImages);

    expect(product.childProducts[0].images).toEqual([
      { url: "https://cdn.example/m.jpg", alt: "Merino Jumper Medium" },
    ]);
  });

  it("does not list the same image twice", () => {
    // EP references one file from both main_image and files, so a gallery bound
    // to `images` showed the same photo twice.
    const dupe: ProductListData = {
      data: [
        {
          id: "child-m",
          type: "product",
          attributes: { name: "Merino Jumper Medium", sku: "MJ-M", status: "live" },
          relationships: {
            main_image: { data: { id: "img-shared", type: "main_image" } },
            files: { data: [{ id: "img-shared", type: "file" }] },
          },
        } as any,
      ],
      included: {
        main_images: [
          { id: "img-shared", type: "file", link: { href: "https://cdn.example/one.jpg" } },
        ],
        files: [
          { id: "img-shared", type: "file", link: { href: "https://cdn.example/one.jpg" } },
        ],
      } as any,
    };

    const product = normalizeProduct(baseProduct, "en-GB", dupe);

    expect(product.childProducts[0].images).toEqual([
      { url: "https://cdn.example/one.jpg", alt: "Merino Jumper Medium" },
    ]);
  });

  it("gives a base product a priceFrom taken from its cheapest child", () => {
    const product = normalizeProduct(baseProduct, "en-GB", children);

    expect(product.meta?.display_price).toBeUndefined();
    expect(product.priceFrom).toEqual({
      amount: 7999,
      currency: "GBP",
      formatted: "£79.99",
      float_price: 79.99,
    });
  });

  it("gives a product that has its own price no priceFrom", () => {
    const product = normalizeProduct(simpleProduct, "en-US");

    expect(product.priceFrom).toBeUndefined();
  });

  it("gives a product from a list the same shape as a product fetched alone", () => {
    const product = normalizeProductFromList(
      {
        id: "list-1",
        type: "product",
        attributes: { name: "Wool Cap", sku: "CAP-1" },
        meta: {
          display_price: {
            without_tax: { amount: 1500, currency: "USD", formatted: "$15.00" },
          },
        },
        relationships: { main_image: { data: { id: "img-1", type: "main_image" } } },
      },
      "en-US",
      { main_images: [{ id: "img-1", link: { href: "https://cdn.example/cap.jpg" } }] }
    );

    expect(product.attributes?.name).toBe("Wool Cap");
    expect(product.meta?.display_price?.without_tax?.float_price).toBe(15);
    expect(product.images).toEqual([
      { url: "https://cdn.example/cap.jpg", alt: "Wool Cap" },
    ]);
    expect(product.variations).toEqual([]);
    expect(product.childProducts).toEqual([]);
  });
});
