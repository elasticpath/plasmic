/**
 * Unit tests for predictionsSource — the pure factory that builds an
 * autocomplete-core source descriptor wired against EP's postMultiSearch.
 *
 * The factory has zero React/DOM dependencies. Tests pass a fake
 * postMultiSearch callable in and assert on the request body it receives
 * and the items returned from `getItems`.
 */

import {
  predictionsSource,
  PredictionsSourceItem,
} from "../predictionsSource";

type MultiSearchResponse = {
  results: Array<{ hits: Array<Record<string, unknown>> }>;
};

function makeOkResponse(hits: Array<Record<string, unknown>>): MultiSearchResponse {
  return { results: [{ hits }] };
}

describe("predictionsSource", () => {
  it("calls postMultiSearch with the autocomplete request shape and the configured predictionsField", async () => {
    const postMultiSearch = jest.fn().mockResolvedValue(makeOkResponse([]));
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch,
    });

    await source.getItems({ query: "leat" });

    expect(postMultiSearch).toHaveBeenCalledTimes(1);
    const body = postMultiSearch.mock.calls[0][0];
    expect(body).toMatchObject({
      searches: [
        expect.objectContaining({
          type: "autocomplete",
          q: "leat",
          include_fields: "q",
          highlight_full_fields: "q",
        }),
      ],
    });
  });

  it("forwards a custom predictionsField into include_fields and highlight_full_fields", async () => {
    const postMultiSearch = jest.fn().mockResolvedValue(makeOkResponse([]));
    const source = predictionsSource({
      predictionsField: "suggestion",
      postMultiSearch,
    });

    await source.getItems({ query: "a" });

    const body = postMultiSearch.mock.calls[0][0];
    expect(body.searches[0]).toMatchObject({
      include_fields: "suggestion",
      highlight_full_fields: "suggestion",
    });
  });

  it("maps response.results[0].hits onto items, preserving the raw hit on _raw", async () => {
    // Plain hits without a `document` wrapper still flatten directly.
    const hit1 = {
      q: "leather bag",
      _highlightResult: { q: { value: "<em>leather</em> bag" } },
    };
    const hit2 = { q: "leather wallet" };
    const postMultiSearch = jest
      .fn()
      .mockResolvedValue(makeOkResponse([hit1, hit2]));
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch,
    });

    const items = (await source.getItems({ query: "leat" })) as PredictionsSourceItem[];

    expect(items).toHaveLength(2);
    expect(items[0]._raw).toBe(hit1);
    expect(items[1]._raw).toBe(hit2);
  });

  it("flattens EP/Typesense hit.document fields onto the item for designer ergonomics", async () => {
    const hit = {
      document: { q: "green", id: "abc", count: 10 },
      highlight: { q: { value: "<mark>green</mark>" } },
      highlights: [{ field: "q", value: "<mark>green</mark>" }],
    };
    const postMultiSearch = jest.fn().mockResolvedValue(makeOkResponse([hit]));
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch,
    });

    const items = (await source.getItems({ query: "gre" })) as PredictionsSourceItem[];

    expect(items[0].q).toBe("green");
    expect(items[0].id).toBe("abc");
    expect(items[0].count).toBe(10);
    // raw hit preserved so designers can reach highlight HTML if needed
    expect(items[0]._raw).toBe(hit);
  });

  it("returns [] when postMultiSearch rejects (does not propagate the error)", async () => {
    const postMultiSearch = jest
      .fn()
      .mockRejectedValue(new Error("boom"));
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch,
    });

    const items = await source.getItems({ query: "leat" });

    expect(items).toEqual([]);
  });

  it("returns [] when response has no results array", async () => {
    const postMultiSearch = jest.fn().mockResolvedValue({});
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch,
    });

    const items = await source.getItems({ query: "leat" });

    expect(items).toEqual([]);
  });

  it("exposes sourceId 'predictions' on the descriptor", () => {
    const source = predictionsSource({
      predictionsField: "q",
      postMultiSearch: jest.fn(),
    });
    expect(source.sourceId).toBe("predictions");
  });
});
