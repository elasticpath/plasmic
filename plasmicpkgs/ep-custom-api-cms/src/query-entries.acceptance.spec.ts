/**
 * Acceptance scenario for the Custom API entry query.
 *
 * The function is obtained through the registration surface — the same route
 * Studio takes to get it — so this covers registration, request construction
 * and response unwrapping together. Only the transport is faked; a builder
 * unit test cannot catch a function that is never registered, or registered
 * under a name nothing looks up.
 */
import { registerAll } from "./index";

interface RecordedRequest {
  url: string;
  query?: Record<string, string | number>;
}

describe("epCms.queryEntries", () => {
  it("returns the named Custom API's entries, requested from the extension endpoint", async () => {
    const requests: RecordedRequest[] = [];
    const request = async (req: RecordedRequest) => {
      requests.push(req);
      return {
        status: 200,
        body: {
          data: [
            {
              id: "0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
              type: "faq_ext",
              question: "Do you ship to Canada?",
            },
          ],
          meta: { results: { total: 1, total_method: "exact" } },
        },
      };
    };

    const registered: Array<[(...args: any[]) => any, { name?: string }]> = [];
    registerAll({
      registerFunction: (fn: any, meta: any) => registered.push([fn, meta]),
    });

    const found = registered.find(([, meta]) => meta.name === "queryEntries");
    if (!found) {
      throw new Error("queryEntries was not registered");
    }
    const [queryEntries] = found;

    const entries = await queryEntries(
      {
        host: "https://euwest.api.elasticpath.com",
        clientId: "abc123",
        customApi: "faqs",
      },
      { request }
    );

    expect(entries).toEqual([
      {
        id: "0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
        type: "faq_ext",
        question: "Do you ship to Canada?",
      },
    ]);
    expect(requests).toEqual([
      {
        url: "https://euwest.api.elasticpath.com/v2/extensions/faqs",
        query: { "page[total_method]": "observed" },
      },
    ]);
  });
});
