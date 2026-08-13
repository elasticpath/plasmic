import { mapEntriesError } from "./errors";

describe("mapEntriesError", () => {
  it("explains a refused read as a missing shopper role policy for that Custom API", () => {
    const err = mapEntriesError(
      {
        status: 403,
        body: {
          errors: [
            {
              status: "403",
              title: "Forbidden",
              detail: "You do not have permission to access this resource.",
            },
          ],
        },
      },
      { customApi: "faqs" }
    );

    expect(err.message).toContain("faqs");
    expect(err.message).toMatch(/role policy/i);
  });

  it("passes through Elastic Path's own detail when it rejects the filter", () => {
    const err = mapEntriesError(
      {
        status: 400,
        body: {
          errors: [
            {
              title: "Bad Request",
              detail:
                "Could not parse the supplied filter: BAD(nope,1).\nSearch operator expected at position 0 got `BAD` at start",
            },
          ],
        },
      },
      { customApi: "faqs" }
    );

    expect(err.message).toContain(
      "Search operator expected at position 0 got `BAD` at start"
    );
  });

  it("points at the credentials when Elastic Path rejects the token", () => {
    const err = mapEntriesError(
      {
        status: 401,
        body: {
          errors: [{ detail: "Unable to validate access token" }],
        },
      },
      { customApi: "faqs" }
    );

    expect(err.message).toMatch(/client id/i);
  });

  it("says the slug names no Custom API when Elastic Path cannot find it", () => {
    const err = mapEntriesError(
      {
        status: 404,
        body: {
          errors: [
            { status: "404", title: "Not Found", detail: "Custom API not found." },
          ],
        },
      },
      { customApi: "faqz" }
    );

    expect(err.message).toContain("faqz");
    expect(err.message).toMatch(/no Custom API/i);
  });

  it("suggests narrowing the query when Elastic Path times it out", () => {
    const err = mapEntriesError(
      {
        status: 422,
        body: {
          errors: [{ detail: "The request took longer than the specified timeout." }],
        },
      },
      { customApi: "locations" }
    );

    expect(err.message).toMatch(/timed out/i);
    expect(err.message).toMatch(/filter|fewer entries/i);
  });
});
