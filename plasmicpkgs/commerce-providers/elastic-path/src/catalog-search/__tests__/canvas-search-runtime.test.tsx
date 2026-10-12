/**
 * @jest-environment jsdom
 *
 * The Studio canvas is not a Next.js app: its bundle resolves next/navigation
 * to a stand-in whose hooks throw. Catalog search is safe there only because
 * EPCatalogSearchProvider never mounts its runtime search tree on the canvas.
 */

import { PlasmicCanvasContext } from "@plasmicapp/host";
import { render } from "@testing-library/react";
import React from "react";

const mockSearchRuntimeMounts: string[] = [];

jest.mock("react-instantsearch", () => ({
  InstantSearch: ({ children }: { children?: React.ReactNode }) => {
    mockSearchRuntimeMounts.push("InstantSearch");
    return <>{children}</>;
  },
  Configure: () => null,
  useInstantSearch: () => ({ status: "idle", error: undefined }),
}));

jest.mock("react-instantsearch-nextjs", () => ({
  InstantSearchNext: ({ children }: { children?: React.ReactNode }) => {
    mockSearchRuntimeMounts.push("InstantSearchNext");
    return <>{children}</>;
  },
}));

jest.mock("@elasticpath/catalog-search-instantsearch-adapter", () => ({
  __esModule: true,
  default: class {
    searchClient = { search: () => Promise.resolve({ results: [] }) };
    constructor() {
      mockSearchRuntimeMounts.push("adapter");
    }
  },
}));

const { EPCatalogSearchProvider } =
  require("../EPCatalogSearchProvider") as typeof import("../EPCatalogSearchProvider");

const PREVIEW_STATES = [
  "auto",
  "withData",
  "loading",
  "empty",
  "error",
] as const;

function renderProvider(
  canvas: React.ContextType<typeof PlasmicCanvasContext>,
  previewState?: (typeof PREVIEW_STATES)[number]
) {
  return render(
    <PlasmicCanvasContext.Provider value={canvas}>
      <EPCatalogSearchProvider previewState={previewState}>
        <span>search surface</span>
      </EPCatalogSearchProvider>
    </PlasmicCanvasContext.Provider>
  );
}

describe("EPCatalogSearchProvider on the Studio canvas", () => {
  beforeEach(() => {
    mockSearchRuntimeMounts.length = 0;
  });

  describe.each([
    ["design mode", { componentName: null, globalVariants: {}, interactive: false }],
    ["interactive mode", { componentName: null, globalVariants: {}, interactive: true }],
  ])("in %s", (_mode, canvas) => {
    it.each([undefined, ...PREVIEW_STATES])(
      "never mounts the search runtime with previewState %s",
      (previewState) => {
        renderProvider(canvas, previewState);

        expect(mockSearchRuntimeMounts).toEqual([]);
      }
    );
  });

  it("mounts the search runtime outside the canvas", () => {
    const { getByText } = renderProvider(false);

    expect(mockSearchRuntimeMounts).toEqual(["adapter", "InstantSearch"]);
    expect(getByText("search surface")).toBeTruthy();
  });
});
