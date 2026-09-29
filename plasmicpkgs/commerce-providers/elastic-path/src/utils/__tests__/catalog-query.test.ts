import { createClient } from "@hey-api/client-fetch";
import { EP_COMMA_ARRAY_QUERY } from "../catalog-query";

// Sent through the SDK's real client, so this checks the query string
// Elastic Path receives, not just that the option was passed.
describe("EP_COMMA_ARRAY_QUERY", () => {
  async function queryStringFor(querySerializer?: typeof EP_COMMA_ARRAY_QUERY) {
    const fetch = jest.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const client = createClient({ baseUrl: "https://ep.test", fetch });
    await client.get({
      url: "/catalog/products",
      query: { include: ["main_image", "files"] },
      ...(querySerializer ? { querySerializer } : {}),
    });
    const request = fetch.mock.calls[0][0] as Request;
    return decodeURIComponent(new URL(request.url).search);
  }

  it("sends an array as one comma-separated value", async () => {
    await expect(queryStringFor(EP_COMMA_ARRAY_QUERY)).resolves.toBe(
      "?include=main_image,files"
    );
  });

  it("differs from the client default, which repeats the key", async () => {
    await expect(queryStringFor()).resolves.toBe(
      "?include=main_image&include=files"
    );
  });
});
