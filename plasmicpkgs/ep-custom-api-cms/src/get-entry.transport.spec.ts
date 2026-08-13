/**
 * The composed-URL seam for the single-entry query.
 *
 * A second request builder is precisely how the host-doubling defect would come
 * back, so this asserts the URL that reaches fetch rather than the builder's
 * output — same reason query-entries.transport.spec.ts exists.
 */
import { registerAll } from "./index";

function jwtExpiringIn(seconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })
  ).toString("base64");
  return `${header}.${payload}.signature`;
}

function registeredQuery(name: string) {
  const registered: Array<[(...args: any[]) => any, { name?: string }]> = [];
  registerAll({
    registerFunction: (fn: any, meta: any) => registered.push([fn, meta]),
  });
  const found = registered.find(([, meta]) => meta.name === name);
  if (!found) {
    throw new Error(`${name} was not registered`);
  }
  return found[0];
}

describe("getEntry over its real transport", () => {
  const realFetch = global.fetch;
  let requested: string[] = [];

  beforeEach(() => {
    requested = [];
    global.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      requested.push(url);

      const body = url.includes("/oauth/access_token")
        ? {
            access_token: jwtExpiringIn(3600),
            expires_in: 3600,
            identifier: "implicit",
            token_type: "Bearer",
          }
        : {
            data: {
              id: "0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
              type: "faq_ext",
              question: "Do you ship to Canada?",
            },
          };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("reads one entry from the store host and returns it unwrapped", async () => {
    const getEntry = registeredQuery("getEntry");

    const entry = await getEntry({
      host: "https://euwest.api.elasticpath.com",
      clientId: "client-for-get-entry-test",
      customApi: "faqs",
      entry: "0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
    });

    expect(
      requested.filter((url) => url.includes("/v2/extensions/"))
    ).toEqual([
      "https://euwest.api.elasticpath.com/v2/extensions/faqs/0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
    ]);
    expect(entry).toEqual({
      id: "0e5eb3d4-c86f-4fdf-8747-083dccf95bc0",
      type: "faq_ext",
      question: "Do you ship to Canada?",
    });
  });
});
