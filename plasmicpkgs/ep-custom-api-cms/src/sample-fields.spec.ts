import { sampleFieldsContext } from "./index";

const host = "https://euwest.api.elasticpath.com";

describe("sampleFieldsContext", () => {
  it("keys the sample by store and Custom API, ignoring the other query params", () => {
    const withParams = sampleFieldsContext({
      host,
      clientId: "abc123",
      customApi: "faqs",
      filter: "eq(status,published)",
      limit: 5,
    });
    const bare = sampleFieldsContext({
      host,
      clientId: "abc123",
      customApi: "faqs",
    });
    const otherApi = sampleFieldsContext({
      host,
      clientId: "abc123",
      customApi: "locations",
    });

    expect(withParams.dataKey).toBe(bare.dataKey);
    expect(otherApi.dataKey).not.toBe(bare.dataKey);
  });

  it("reports the fields of a sampled entry", async () => {
    const requests: Array<{ url: string; query?: Record<string, unknown> }> = [];
    const request = async (req: any) => {
      requests.push(req);
      return {
        status: 200,
        body: {
          data: [
            { id: "0e5eb3d4", type: "faq_ext", question: "Ship to Canada?" },
          ],
        },
      };
    };

    const { fetcher } = sampleFieldsContext(
      { host, clientId: "abc123", customApi: "faqs" },
      { request }
    );

    await expect(fetcher()).resolves.toEqual({
      fields: [{ name: "question", type: "string" }],
    });
    // One entry is all a sample needs; a design-time lookup must not pull a page.
    expect(requests[0].query).toMatchObject({ "page[limit]": 1 });
  });

  // A Custom API the store has not exposed to shoppers still has to be usable in
  // the editor — the designer may be building against one an administrator is
  // about to grant. The hint simply falls back to showing the filter syntax.
  it("yields no fields, without failing, when the sample is refused", async () => {
    const { fetcher } = sampleFieldsContext(
      { host, clientId: "abc123", customApi: "faqs" },
      { request: async () => ({ status: 403, body: {} }) }
    );

    await expect(fetcher()).resolves.toEqual({ fields: [] });
  });
});
