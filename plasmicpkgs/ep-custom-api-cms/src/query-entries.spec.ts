import { defaultDeps, queryEntries } from "./index";

describe("defaultDeps", () => {
  // Studio calls the registered function with the query's arguments only, so
  // the transport has to come from those arguments. Whether the resulting port
  // reaches Elastic Path is not asserted here — that is the Studio check in
  // this issue's last chunk, per the decision to keep the SDK out of the suite.
  it("builds a transport from the credentials on the query", () => {
    const deps = defaultDeps({
      host: "https://euwest.api.elasticpath.com",
      clientId: "abc123",
      customApi: "faqs",
    });

    expect(typeof deps.request).toBe("function");
  });
});

describe("queryEntries", () => {
  // Characterisation: the empty-array fallback already exists, so this test is
  // born green. It is here to hold the behaviour, not to have driven it — a
  // malformed response must render an empty section, never crash a page.
  it("yields no entries when the response carries no data array", async () => {
    const entries = await queryEntries(
      {
        host: "https://euwest.api.elasticpath.com",
        clientId: "abc123",
        customApi: "faqs",
      },
      { request: async () => ({ status: 200, body: {} }) }
    );

    expect(entries).toEqual([]);
  });
});
