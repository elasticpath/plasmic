/** Asserts what a call site can observe: where the request goes, and what comes back. */
import {
  createEpIdentityClient,
  epIdentityErrorCode,
} from "../client";
import { EP_IDENTITY_ROUTES } from "../operations";

interface Call {
  url: string;
  init: RequestInit;
}

function fetchStub(
  respond: (call: Call) => Response | Promise<Response>
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: any, init: any = {}) => {
    calls.push({ url: String(input), init });
    return respond({ url: String(input), init });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ENVELOPE = {
  user: { id: "u1", email: "buyer@example.com" },
  session: { id: "s1", userId: "u1", epMemberId: "m1" },
};

describe("createEpIdentityClient", () => {
  it("reaches every operation without the caller naming a path", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.getSession();
    await client.signInAnonymously();
    await client.refresh();
    await client.setCart({ cartId: "cart-1" });
    await client.login({ username: "buyer@example.com", password: "pw" });
    await client.roster();
    await client.selectAccount({ accountId: "acct-1" });
    await client.rollAccount();
    await client.logout();

    expect(stub.calls.map((c) => c.url)).toEqual([
      "/api/ep/get-session",
      "/api/ep/ep/anonymous",
      "/api/ep/ep/refresh",
      "/api/ep/ep/cart",
      "/api/ep/ep/account/login",
      "/api/ep/ep/account/roster",
      "/api/ep/ep/account/select",
      "/api/ep/ep/account/roll",
      "/api/ep/ep/account/logout",
    ]);
  });

  it("follows a handler mounted somewhere other than the default", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({
      basePath: "/api/store",
      fetch: stub.fetch,
    });

    await client.login({ username: "buyer@example.com", password: "pw" });

    expect(stub.calls[0].url).toBe("/api/store/ep/account/login");
  });

  it("tolerates a base path written with a trailing slash", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({
      basePath: "/api/store/",
      fetch: stub.fetch,
    });

    await client.logout();

    expect(stub.calls[0].url).toBe("/api/store/ep/account/logout");
  });

  it("sends the shopper's cookies, which are the only identity input", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.signInAnonymously();

    expect(stub.calls[0].init.credentials).toBe("include");
  });

  it("asks for the session with a GET carrying no body", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.getSession();

    expect(stub.calls[0].init.method).toBe("GET");
    expect(stub.calls[0].init.body).toBeUndefined();
  });

  it("sends the credentials it was given, and nothing else", async () => {
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.login({ username: "buyer@example.com", password: "pw" });

    expect(JSON.parse(stub.calls[0].init.body as string)).toEqual({
      username: "buyer@example.com",
      password: "pw",
    });
  });

  it("asks for the first page of the roster when given no paging", async () => {
    const stub = fetchStub(() => json({ accounts: [], total: 0 }));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.roster();

    expect(stub.calls[0].init.method).toBe("POST");
    expect(JSON.parse(stub.calls[0].init.body as string)).toEqual({});
  });

  it("returns the roster the server reported", async () => {
    const roster = {
      accounts: [
        { id: "a1", name: "Northwind" },
        { id: "a2", name: "Acme" },
      ],
      total: 2,
    };
    const stub = fetchStub(() => json(roster));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await expect(client.roster()).resolves.toEqual(roster);
  });

  it("reports no session as an absence rather than a failure", async () => {
    const stub = fetchStub(() => json(null));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await expect(client.getSession()).resolves.toBeNull();
  });

  it("carries the server's code on a refusal, so a caller can branch on it", async () => {
    const stub = fetchStub(() =>
      json(
        {
          error: "account_lapsed",
          code: "account_lapsed",
          message: "The account credential ran out.",
        },
        401
      )
    );
    const client = createEpIdentityClient({ fetch: stub.fetch });

    const err = await client.roster().catch((e) => e);

    expect(epIdentityErrorCode(err)).toBe("account_lapsed");
    expect(err.status).toBe(401);
  });

  it("still fails loudly when a refusal carries no readable body", async () => {
    const stub = fetchStub(() => new Response("gateway down", { status: 502 }));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    const err = await client.rollAccount().catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(502);
  });

  it("covers every declared operation", () => {
    const client = createEpIdentityClient({ fetch: fetchStub(() => json(null)).fetch });

    for (const name of Object.keys(EP_IDENTITY_ROUTES)) {
      expect(typeof (client as any)[name]).toBe("function");
    }
  });
});

describe("createEpIdentityClient in a Studio canvas", () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it("stays relative, so it resolves against whatever document serves the artboard", async () => {
    (globalThis as any).window = {};
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.signInAnonymously();

    expect(stub.calls[0].url).toBe("/api/ep/ep/anonymous");
  });

  it("follows the pin when the page is served from another origin", async () => {
    (globalThis as any).window = { __epProxyOrigin: "http://localhost:3456/" };
    const stub = fetchStub(() => json(ENVELOPE));
    const client = createEpIdentityClient({ fetch: stub.fetch });

    await client.signInAnonymously();

    expect(stub.calls[0].url).toBe(
      "http://localhost:3456/api/ep/ep/anonymous"
    );
  });
});
