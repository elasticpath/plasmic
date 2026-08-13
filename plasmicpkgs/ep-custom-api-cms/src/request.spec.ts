import { buildEntriesRequest, buildEntryRequest } from "./request";

describe("buildEntryRequest", () => {
  // Matched on a distinctive phrase, not /entry/i: while buildEntryRequest did
  // not exist, "buildEntryRequest is not a function" satisfied /entry/i and the
  // test passed against nothing at all.
  it("refuses to build a request when no entry is identified", () => {
    expect(() => buildEntryRequest({ customApi: "faqs", entry: "" })).toThrow(
      /No entry identified/
    );
  });

  // One behaviour, two kinds of value: Elastic Path swaps the id for the
  // url-slug field's value in the same position, so both are the same segment.
  it("places the identifier as the path segment, id or url slug alike", () => {
    expect(
      buildEntryRequest({ customApi: "faqs", entry: "0e5eb3d4-c86f" })
    ).toEqual({ url: "/v2/extensions/faqs/0e5eb3d4-c86f", query: {} });

    expect(
      buildEntryRequest({ customApi: "faqs", entry: "shipping-to-canada" })
    ).toEqual({ url: "/v2/extensions/faqs/shipping-to-canada", query: {} });
  });
});

describe("buildEntriesRequest", () => {
  it("refuses to build a request when no Custom API is named", () => {
    expect(() => buildEntriesRequest({ customApi: "" })).toThrow(/Custom API/);
  });

  // The host belongs to the transport's base URL, never to the path this
  // builds — emitting an absolute URL here made the SDK concatenate the host
  // twice, which is what the earlier version of this expectation enshrined.
  // A host pasted with a trailing slash is covered at the transport seam in
  // query-entries.transport.spec.ts, since that is where the host now lives.
  it("addresses the extension endpoint by slug and always asks for the cheap total", () => {
    expect(buildEntriesRequest({ customApi: "faqs" })).toEqual({
      url: "/v2/extensions/faqs",
      query: { "page[total_method]": "observed" },
    });
  });

  it("passes the filter through exactly as the designer wrote it", () => {
    const req = buildEntriesRequest({
      customApi: "faqs",
      filter: "like(question,*Canada*)",
    });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      filter: "like(question,*Canada*)",
    });
  });

  it("sends the chosen sort attribute", () => {
    const req = buildEntriesRequest({ customApi: "faqs", sort: "-updated_at" });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      sort: "-updated_at",
    });
  });

  it("disables ordering when the designer picks unsorted", () => {
    const req = buildEntriesRequest({ customApi: "faqs", sort: "unsorted" });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      sort: "null",
    });
  });

  it("pages with the limit and offset the designer set", () => {
    const req = buildEntriesRequest({
      customApi: "faqs",
      limit: 10,
      offset: 20,
    });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      "page[limit]": 10,
      "page[offset]": 20,
    });
  });
});
