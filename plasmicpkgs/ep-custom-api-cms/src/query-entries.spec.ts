import { queryEntries } from "./index";

describe("queryEntries", () => {
  // Characterisation: the empty-array fallback already exists, so this test is
  // born green. It is here to hold the behaviour, not to have driven it — a
  // malformed response must render an empty section, never crash a page.
  it("yields no entries when the response carries no data array", async () => {
    const entries = await queryEntries(
      { host: "https://euwest.api.elasticpath.com", customApi: "faqs" },
      { request: async () => ({ status: 200, body: {} }) }
    );

    expect(entries).toEqual([]);
  });
});
