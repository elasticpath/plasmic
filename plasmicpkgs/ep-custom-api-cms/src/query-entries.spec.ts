import { defaultDeps, queryEntries } from "./index";

describe("queryEntries credentials", () => {
  // The editor marks host required, but a dynamic binding can still evaluate to
  // an empty string. Without a guard that reaches fetch as a relative URL and
  // fails with a parse error naming neither the host nor the Custom API.
  it("refuses a blank region host with a message naming what is missing", async () => {
    await expect(
      queryEntries({ host: "", clientId: "abc123", customApi: "faqs" })
    ).rejects.toThrow(/region host/i);
  });
});

describe("queryEntries transport failures", () => {
  // Every HTTP failure gets a mapped, actionable message; a transport that never
  // reaches Elastic Path should not be the one case that surfaces raw.
  it("reports an unreachable host, naming the host and the Custom API", async () => {
    const request = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      queryEntries(
        {
          host: "https://euwest.api.elasticpath.com",
          clientId: "abc123",
          customApi: "faqs",
        },
        { request }
      )
    ).rejects.toThrow(/euwest\.api\.elasticpath\.com[\s\S]*faqs|faqs[\s\S]*euwest/);
  });
});

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
