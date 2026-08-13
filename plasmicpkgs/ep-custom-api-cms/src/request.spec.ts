import { buildEntriesRequest } from "./request";

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
