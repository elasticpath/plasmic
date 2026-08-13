/**
 * The seam nothing else crosses: builder → transport → fetch.
 *
 * Every other spec asserts one layer against a fake — the builder's URL against
 * a literal, the port's mapping against a stub client — so a mismatch between
 * the URL the builder emits and the base URL the client is configured with is
 * invisible to all of them. These tests call the query the way Studio does,
 * with a single argument and no injected transport, and assert what actually
 * reaches fetch.
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

describe("queryEntries over its real transport", () => {
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
        : { data: [{ id: "entry-1", type: "faq_ext" }] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it("requests the entries from the store host, with the host appearing once", async () => {
    const queryEntries = registeredQuery("queryEntries");

    await queryEntries({
      host: "https://euwest.api.elasticpath.com",
      clientId: "client-for-url-test",
      customApi: "faqs",
    });

    const entriesRequests = requested.filter((url) =>
      url.includes("/v2/extensions/")
    );
    expect(entriesRequests).toEqual([
      "https://euwest.api.elasticpath.com/v2/extensions/faqs?page[total_method]=observed",
    ]);
  });

  // The guarantee that used to live on the builder, now asserted where the host
  // actually reaches the wire.
  it("tolerates a host pasted with a trailing slash", async () => {
    const queryEntries = registeredQuery("queryEntries");

    await queryEntries({
      host: "https://euwest.api.elasticpath.com/",
      clientId: "client-for-trailing-slash-test",
      customApi: "faqs",
    });

    const entriesRequests = requested.filter((url) =>
      url.includes("/v2/extensions/")
    );
    expect(entriesRequests).toEqual([
      "https://euwest.api.elasticpath.com/v2/extensions/faqs?page[total_method]=observed",
    ]);
  });

  // The stub token is JWT-shaped on purpose: the SDK treats a token it cannot
  // read an `exp` from as already expired, so an opaque token would be re-minted
  // per request and this test would pass for the wrong reason.
  it("mints one token for two queries against the same store", async () => {
    const queryEntries = registeredQuery("queryEntries");
    const opts = {
      host: "https://euwest.api.elasticpath.com",
      clientId: "client-for-token-reuse-test",
      customApi: "faqs",
    };

    await queryEntries(opts);
    await queryEntries(opts);

    const tokenRequests = requested.filter((url) =>
      url.includes("/oauth/access_token")
    );
    expect(tokenRequests).toHaveLength(1);
  });
});
