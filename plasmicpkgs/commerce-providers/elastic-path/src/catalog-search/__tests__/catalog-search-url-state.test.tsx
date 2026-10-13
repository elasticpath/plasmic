/**
 * @jest-environment jsdom
 */
import { render, waitFor } from "@testing-library/react";
import React from "react";

const mockEpMultiSearch = jest.fn(async (args: any) => ({
  results: args.searches.map(() => ({
    hits: [],
    found: 0,
    out_of: 0,
    page: 1,
    request_params: { per_page: 12 },
    search_time_ms: 1,
    facet_counts: [],
  })),
}));

jest.mock("../../ep-server-functions/multiSearch", () => ({
  __esModule: true,
  epMultiSearch: (...a: any[]) => (mockEpMultiSearch as any)(...a),
}));

// The loader's stand-in for `next/navigation` outside the App Router.
jest.mock("next/navigation.js", () => ({
  ServerInsertedHTMLContext: jest.requireActual("react").createContext(null),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => ({}),
}));

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  usePlasmicCanvasContext: () => null,
}));

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const { EPCatalogSearchProvider } =
  require("../EPCatalogSearchProvider") as typeof import("../EPCatalogSearchProvider");

function searchedQueries(): string[] {
  return mockEpMultiSearch.mock.calls.flatMap((call: any[]) =>
    call[0].searches.map((s: any) => s.q)
  );
}

describe("EPCatalogSearchProvider URL state", () => {
  it("searches for the query in the page URL when no search box is on the page", async () => {
    window.history.replaceState({}, "", "/?search%5Bquery%5D=shirt");

    render(
      <EPCatalogSearchProvider>
        <div />
      </EPCatalogSearchProvider>
    );

    await waitFor(() => expect(mockEpMultiSearch).toHaveBeenCalled());
    expect(searchedQueries()).toEqual(["shirt"]);
  });
});
