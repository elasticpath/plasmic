const mockPostMultiSearch = jest.fn();

jest.mock("@epcc-sdk/sdks-shopper", () => ({
  createShopperClient: jest.fn(() => ({
    client: {
      interceptors: { request: { use: jest.fn() } },
    },
  })),
  postMultiSearch: (...args: unknown[]) => mockPostMultiSearch(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { epMultiSearch } = require("../multiSearch");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { withEpSession } = require("../session-context");

const SESSION = {
  accessToken: "tok",
  host: "https://api.ep.com",
  clientId: "cid",
};

beforeEach(() => {
  mockPostMultiSearch.mockReset();
});

describe("epMultiSearch", () => {
  it("keeps the included block that carries each hit's image", async () => {
    const payload = {
      results: [
        {
          hits: [
            {
              document: { id: "p1", name: "Shoe" },
              relationships: { main_image: { data: { id: "img-1" } } },
            },
          ],
          found: 1,
        },
      ],
      included: {
        main_images: [{ id: "img-1", link: { href: "https://cdn/img-1.jpg" } }],
      },
    };
    mockPostMultiSearch.mockResolvedValue({ data: payload });

    const result = await withEpSession(SESSION, () =>
      epMultiSearch({ searches: [{ type: "autocomplete", q: "sho" }] })
    );

    expect(result).toEqual(payload);
    expect(result.included.main_images[0].link.href).toBe(
      "https://cdn/img-1.jpg"
    );
  });

  it("asks Elastic Path for the included block when a caller wants images", async () => {
    mockPostMultiSearch.mockResolvedValue({ data: {} });

    await withEpSession(SESSION, () =>
      epMultiSearch({ searches: [{ q: "a" }], include: ["main_image"] })
    );

    // Elastic Path omits `included` entirely unless `include` is sent, so a
    // function that cannot send it can never carry a hit's image.
    expect(mockPostMultiSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: { include: ["main_image"] } })
    );
  });

  it("sends no include query when the caller asks for none", async () => {
    mockPostMultiSearch.mockResolvedValue({ data: {} });

    await withEpSession(SESSION, () => epMultiSearch({ searches: [{ q: "a" }] }));

    expect(mockPostMultiSearch.mock.calls[0][0]).not.toHaveProperty("query");
  });

  it("passes the searches through as written", async () => {
    mockPostMultiSearch.mockResolvedValue({ data: {} });
    const searches = [
      {
        type: "autocomplete",
        q: "sho",
        include_fields: "q",
        highlight_full_fields: "q",
      },
    ];

    await withEpSession(SESSION, () => epMultiSearch({ searches }));

    expect(mockPostMultiSearch).toHaveBeenCalledWith(
      expect.objectContaining({ body: { searches } })
    );
  });

  it("throws when the search fails, rather than reading as no hits", async () => {
    mockPostMultiSearch.mockRejectedValue(new Error("boom"));

    await expect(
      withEpSession(SESSION, () => epMultiSearch({ searches: [{ q: "x" }] }))
    ).rejects.toThrow("boom");
  });

  it("throws when Elastic Path soft-fails with { error }", async () => {
    mockPostMultiSearch.mockResolvedValue({
      error: { errors: [{ detail: "index unavailable" }] },
    });

    await expect(
      withEpSession(SESSION, () => epMultiSearch({ searches: [{ q: "x" }] }))
    ).rejects.toThrow(/index unavailable/);
  });

  it("returns an empty result set as an empty result set", async () => {
    mockPostMultiSearch.mockResolvedValue({
      data: { results: [{ hits: [], found: 0 }] },
    });

    const result = await withEpSession(SESSION, () =>
      epMultiSearch({ searches: [{ q: "nomatch" }] })
    );
    expect(result.results[0].hits).toEqual([]);
  });

  it("returns an empty response when called outside withEpSession", async () => {
    const result = await epMultiSearch({ searches: [{ q: "x" }] });
    expect(result).toEqual({});
    expect(mockPostMultiSearch).not.toHaveBeenCalled();
  });
});
