import { getEntry } from "./index";

describe("getEntry", () => {
  // Characterisation: the shared read path already throws on a non-2xx, but no
  // test drove that status branch through a query rather than through the error
  // mapper in isolation. A detail page bound to a stale slug must say so, not
  // render a page of blanks.
  it("fails rather than returning nothing when the entry does not exist", async () => {
    const request = async () => ({
      status: 404,
      body: { errors: [{ detail: "Custom API Entry not found." }] },
    });

    await expect(
      getEntry(
        {
          host: "https://euwest.api.elasticpath.com",
          clientId: "abc123",
          customApi: "faqs",
          entry: "shipping-to-canada",
        },
        { request }
      )
    ).rejects.toThrow(/shipping-to-canada/);
  });
});
