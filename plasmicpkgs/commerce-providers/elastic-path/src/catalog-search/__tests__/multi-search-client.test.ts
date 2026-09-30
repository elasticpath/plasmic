/**
 * The object handed to the catalog-search adapter in place of an Elastic Path
 * client. The adapter reaches for exactly one method on it, so these tests
 * pin the shape the shopper SDK's `postMultiSearch` calls it with.
 */
const mockEpMultiSearch = jest.fn();

jest.mock("../../ep-server-functions/multiSearch", () => ({
  epMultiSearch: (...args: any[]) => mockEpMultiSearch(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMultiSearchClient, groupFilterBy } =
  require("../multi-search-client") as typeof import("../multi-search-client");

beforeEach(() => {
  mockEpMultiSearch.mockReset();
  mockEpMultiSearch.mockResolvedValue({ results: [] });
});

describe("createMultiSearchClient", () => {
  it("runs the adapter's searches through epMultiSearch", async () => {
    const client = createMultiSearchClient();
    const payload = { results: [{ hits: [{ document: { id: "p1" } }] }] };
    mockEpMultiSearch.mockResolvedValue(payload);

    const response = await client.post({
      body: { searches: [{ type: "search", q: "boots" }] },
      query: { include: ["main_image"] },
    });

    expect(mockEpMultiSearch).toHaveBeenCalledWith({
      searches: [{ type: "search", q: "boots" }],
      include: ["main_image"],
    });
    expect(response).toEqual({ data: payload });
  });

  it("omits include when the adapter asks for nothing side-loaded", async () => {
    const client = createMultiSearchClient();

    await client.post({ body: { searches: [{ q: "boots" }] } });

    expect(mockEpMultiSearch).toHaveBeenCalledWith({ searches: [{ q: "boots" }] });
  });

  it("lets a failed search throw rather than answering with no hits", async () => {
    // Soft-failing to an empty payload would render a search outage as a
    // no-results page, which a shopper cannot tell from a working search.
    const client = createMultiSearchClient();
    mockEpMultiSearch.mockRejectedValue(new Error("multi-search unavailable"));

    await expect(
      client.post({ body: { searches: [{ q: "boots" }] } })
    ).rejects.toThrow("multi-search unavailable");
  });
});

describe("groupFilterBy", () => {
  // Defence in depth, not a fix: Elastic Path already composes the store's
  // search-profile filter as `(profile) && (request)`, so nothing a designer
  // puts in Base Filter can widen it. These pin the wrap so that stays true
  // if the platform's composition ever changes.
  it("wraps a composed filter_by in its own group", () => {
    expect(
      groupFilterBy({
        q: "boots",
        filter_by: "meta.product_types:!=child && price:>10",
      })
    ).toEqual({
      q: "boots",
      filter_by: "(meta.product_types:!=child && price:>10)",
    });
  });

  it("wraps a filter a designer could otherwise leave open-ended", () => {
    expect(
      groupFilterBy({ filter_by: "price:>0 || category:=sale" }).filter_by
    ).toBe("(price:>0 || category:=sale)");
  });

  it("leaves a search with no filter_by untouched", () => {
    const search = { q: "boots" };
    expect(groupFilterBy(search)).toBe(search);
  });

  it("leaves an empty filter_by untouched rather than sending ()", () => {
    const search = { q: "boots", filter_by: "" };
    expect(groupFilterBy(search)).toBe(search);
  });
});
