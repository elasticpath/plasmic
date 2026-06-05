/**
 * @jest-environment jsdom
 *
 * EPProductField search-highlight rendering (ADR-0011 D3). The component reads
 * the current product via useSelector; the SearchHitProduct extras
 * (_highlightedName / _snippetedDescription) drive the <mark> markup.
 */

jest.mock("@plasmicapp/host", () => {
  const React = require("react");
  return {
    DataProvider: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    useSelector: jest.fn(),
    usePlasmicCanvasContext: jest.fn().mockReturnValue(null),
    repeatedElement: jest.fn((_i: number, children: any) => children),
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import React from "react";
import { render } from "@testing-library/react";

const {
  useSelector: mockUseSelector,
  usePlasmicCanvasContext: mockUsePlasmicCanvasContext,
} = require("@plasmicapp/host");
const { EPProductField } = require("../EPProductField");

function setProduct(product: Record<string, any> | undefined) {
  (mockUseSelector as jest.Mock).mockImplementation((key: string) =>
    key === "currentProduct" ? product : undefined,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockUsePlasmicCanvasContext as jest.Mock).mockReturnValue(null);
});

const hitProduct = {
  id: "p1",
  name: "Leather Bag",
  description: "A full-grain leather bag.",
  price: { value: 10, currencyCode: "USD" },
  images: [],
  options: [],
  variants: [],
  _highlightedName: "<mark>Leather</mark> Bag",
  _snippetedDescription: "a full-grain <mark>leather</mark> bag",
};

describe("EPProductField highlight (D3)", () => {
  it("highlight=auto renders the <mark> name markup in a hit", () => {
    setProduct(hitProduct);
    const { container } = render(
      <EPProductField field="name" highlight="auto" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.innerHTML).toBe("<mark>Leather</mark> Bag");
  });

  it("highlight=auto renders the snippeted abstract for description", () => {
    setProduct(hitProduct);
    const { container } = render(
      <EPProductField field="description" highlight="auto" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.innerHTML).toBe("a full-grain <mark>leather</mark> bag");
  });

  it("highlight=auto is inert on a PDP product (no _highlighted*) — plain text", () => {
    setProduct({
      id: "p2",
      name: "Plain Bag",
      price: { value: 10, currencyCode: "USD" },
      images: [],
      options: [],
      variants: [],
    });
    const { container } = render(
      <EPProductField field="name" highlight="auto" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.textContent).toBe("Plain Bag");
    expect(leaf.querySelector("mark")).toBeNull();
  });

  it("highlight=off (default) never renders markup even on a hit", () => {
    setProduct(hitProduct);
    const { container } = render(<EPProductField field="name" />);
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.textContent).toBe("Leather Bag");
    expect(leaf.querySelector("mark")).toBeNull();
  });

  it("highlight=on renders the variant markup but NEVER injects the raw value as HTML", () => {
    // A hit-less product whose name contains HTML metacharacters: `on` must
    // fall back to plain text, not render the value via dangerouslySetInnerHTML
    // (the html:true footgun ADR-0011 D3 exists to remove).
    setProduct({
      id: "p3",
      name: "Foo & Bar <script>alert(1)</script>",
      price: { value: 10, currencyCode: "USD" },
      images: [],
      options: [],
      variants: [],
    });
    const { container } = render(
      <EPProductField field="name" highlight="on" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    // rendered as text — no <script> element materialized
    expect(leaf.querySelector("script")).toBeNull();
    expect(leaf.textContent).toBe("Foo & Bar <script>alert(1)</script>");
  });

  it("highlight=on renders the <mark> variant as HTML when the hit has one", () => {
    setProduct(hitProduct);
    const { container } = render(
      <EPProductField field="name" highlight="on" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.innerHTML).toBe("<mark>Leather</mark> Bag");
  });

  it("highlight only applies to query_by fields — other leaves ignore it", () => {
    setProduct({ ...hitProduct, sku: "SKU-1" });
    const { container } = render(
      <EPProductField field="sku" highlight="auto" />,
    );
    const leaf = container.querySelector("[data-ep-product-field]")!;
    expect(leaf.textContent).toBe("SKU-1");
    expect(leaf.querySelector("mark")).toBeNull();
  });
});
