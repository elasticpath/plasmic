import { buildEntriesRequest } from "./request";

describe("buildEntriesRequest", () => {
  it("refuses to build a request when no Custom API is named", () => {
    expect(() =>
      buildEntriesRequest({
        host: "https://euwest.api.elasticpath.com",
        customApi: "",
      })
    ).toThrow(/Custom API/);
  });

  it("addresses the extension endpoint by slug and always asks for the cheap total", () => {
    expect(
      buildEntriesRequest({
        host: "https://euwest.api.elasticpath.com",
        customApi: "faqs",
      })
    ).toEqual({
      url: "https://euwest.api.elasticpath.com/v2/extensions/faqs",
      query: { "page[total_method]": "observed" },
    });
  });

  it("passes the filter through exactly as the designer wrote it", () => {
    const req = buildEntriesRequest({
      host: "https://euwest.api.elasticpath.com",
      customApi: "faqs",
      filter: "like(question,*Canada*)",
    });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      filter: "like(question,*Canada*)",
    });
  });

  it("sends the chosen sort attribute", () => {
    const req = buildEntriesRequest({
      host: "https://euwest.api.elasticpath.com",
      customApi: "faqs",
      sort: "-updated_at",
    });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      sort: "-updated_at",
    });
  });

  it("disables ordering when the designer picks unsorted", () => {
    const req = buildEntriesRequest({
      host: "https://euwest.api.elasticpath.com",
      customApi: "faqs",
      sort: "unsorted",
    });

    expect(req.query).toEqual({
      "page[total_method]": "observed",
      sort: "null",
    });
  });

  it("pages with the limit and offset the designer set", () => {
    const req = buildEntriesRequest({
      host: "https://euwest.api.elasticpath.com",
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

  it("builds one clean URL from a host pasted with a trailing slash", () => {
    const req = buildEntriesRequest({
      host: "https://euwest.api.elasticpath.com/",
      customApi: "faqs",
    });

    expect(req.url).toBe("https://euwest.api.elasticpath.com/v2/extensions/faqs");
  });
});
