/**
 * The account-member token call. Response shapes are the ones the integration
 * store returns live: `meta.account_member_id`, `meta.results.total`, and a
 * `data` entry per account carrying `account_id`, `account_name`, `token` and
 * an ISO-8601 `expires`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_PAGE_LIMIT_MAX,
  EpAccountTokenError,
  clampAccountPageLimit,
  clampAccountPageOffset,
  discoverPasswordProfileId,
  findAccountToken,
  mintAccountTokens,
  toAccountRoster,
} from "../account-tokens";

const HOST = "https://api.test.elasticpath.com";
const IMPLICIT = "implicit-token";
const REALM = "realm-1";
const EXPIRES_ISO = "2026-09-23T12:13:45.571Z";
const EXPIRES_SECONDS = Math.floor(Date.parse(EXPIRES_ISO) / 1000);

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function tokenResponse(
  accounts: { id: string; name?: string }[],
  total = accounts.length
) {
  return new Response(
    JSON.stringify({
      meta: {
        account_member_id: "member-1",
        page: { limit: 100, offset: 0, current: 1, total: 1 },
        results: { total },
      },
      data: accounts.map((account) => ({
        account_id: account.id,
        account_name: account.name,
        token: `token-for-${account.id}`,
        type: "account_management_authentication_token",
        expires: EXPIRES_ISO,
      })),
    }),
    { status: 201, headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(status: number, detail: string) {
  return new Response(
    JSON.stringify({ errors: [{ detail, status: String(status) }] }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function profilesFetch(profiles: { id: string; name?: string }[]) {
  return vi.fn(async (url: any) => {
    const u = String(url);
    if (u === `${HOST}/v2/settings/account-authentication`) {
      return new Response(
        JSON.stringify({
          data: {
            relationships: {
              authentication_realm: { data: { id: REALM } },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u === `${HOST}/v2/authentication-realms/${REALM}/password-profiles`) {
      return new Response(JSON.stringify({ data: profiles }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected URL: ${u}`);
  });
}

describe("discoverPasswordProfileId", () => {
  it("resolves the single profile on the store's realm", async () => {
    globalThis.fetch = profilesFetch([
      { id: "profile-1", name: "password" },
    ]) as any;
    await expect(
      discoverPasswordProfileId({ host: HOST, implicitToken: IMPLICIT })
    ).resolves.toBe("profile-1");
  });

  it("names every candidate rather than guessing between them", async () => {
    globalThis.fetch = profilesFetch([
      { id: "profile-1", name: "password" },
      { id: "profile-2", name: "passTest" },
    ]) as any;
    await expect(
      discoverPasswordProfileId({ host: HOST, implicitToken: IMPLICIT })
    ).rejects.toMatchObject({ code: "password_profile_ambiguous" });
    const message = await discoverPasswordProfileId({
      host: HOST,
      implicitToken: IMPLICIT,
    }).catch((err) => (err as Error).message);
    expect(message).toContain("profile-1");
    expect(message).toContain("profile-2");
    expect(message).toContain("passwordProfileId");
  });

  it("says so when the realm carries no password profile at all", async () => {
    globalThis.fetch = profilesFetch([]) as any;
    await expect(
      discoverPasswordProfileId({ host: HOST, implicitToken: IMPLICIT })
    ).rejects.toMatchObject({ code: "password_profile_unresolved" });
  });
});

describe("mintAccountTokens with a password", () => {
  it("returns the member, the roster and one token per account", async () => {
    globalThis.fetch = vi.fn(async () =>
      tokenResponse([
        { id: "acct-a", name: "Acme North" },
        { id: "acct-b", name: "Acme South" },
      ])
    ) as any;

    const page = await mintAccountTokens({
      host: HOST,
      implicitToken: IMPLICIT,
      credential: {
        passwordProfileId: "profile-1",
        username: "buyer@example.com",
        password: "secret",
      },
    });

    expect(page.memberId).toBe("member-1");
    expect(page.total).toBe(2);
    expect(page.entries).toEqual([
      {
        id: "acct-a",
        name: "Acme North",
        token: "token-for-acct-a",
        expires: EXPIRES_SECONDS,
      },
      {
        id: "acct-b",
        name: "Acme South",
        token: "token-for-acct-b",
        expires: EXPIRES_SECONDS,
      },
    ]);
  });

  it("sends the password mechanism and no account header", async () => {
    const fetchMock = vi.fn(async () => tokenResponse([{ id: "acct-a" }]));
    globalThis.fetch = fetchMock as any;

    await mintAccountTokens({
      host: HOST,
      implicitToken: IMPLICIT,
      credential: {
        passwordProfileId: "profile-1",
        username: "buyer@example.com",
        password: "secret",
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(String(url)).toContain("/v2/account-members/tokens");
    expect(JSON.parse(init.body).data).toMatchObject({
      authentication_mechanism: "password",
      password_profile_id: "profile-1",
      username: "buyer@example.com",
    });
    expect(
      init.headers["EP-Account-Management-Authentication-Token"]
    ).toBeUndefined();
  });

  it("reports a rejected password as a failed sign-in, not an outage", async () => {
    globalThis.fetch = vi.fn(async () =>
      errorResponse(400, "authentication failed")
    ) as any;

    await expect(
      mintAccountTokens({
        host: HOST,
        implicitToken: IMPLICIT,
        credential: {
          passwordProfileId: "profile-1",
          username: "buyer@example.com",
          password: "wrong",
        },
      })
    ).rejects.toMatchObject({ code: "invalid_credentials", status: 401 });
  });

  it("succeeds for a member who belongs to no account at all", async () => {
    globalThis.fetch = vi.fn(async () => tokenResponse([], 0)) as any;

    const page = await mintAccountTokens({
      host: HOST,
      implicitToken: IMPLICIT,
      credential: {
        passwordProfileId: "profile-1",
        username: "buyer@example.com",
        password: "secret",
      },
    });

    expect(page.memberId).toBe("member-1");
    expect(page.total).toBe(0);
    expect(page.entries).toEqual([]);
  });
});

describe("mintAccountTokens from an account token", () => {
  it("re-mints with the held token in the header and no credentials", async () => {
    const fetchMock = vi.fn(async () => tokenResponse([{ id: "acct-a" }]));
    globalThis.fetch = fetchMock as any;

    await mintAccountTokens({
      host: HOST,
      implicitToken: IMPLICIT,
      credential: { accountToken: "held-token" },
    });

    const [, init] = fetchMock.mock.calls[0] as any;
    expect(init.headers["EP-Account-Management-Authentication-Token"]).toBe(
      "held-token"
    );
    const body = JSON.parse(init.body).data;
    expect(body.authentication_mechanism).toBe(
      "account_management_authentication_token"
    );
    expect(body).not.toHaveProperty("password");
  });

  it("forwards the page the caller asked for, capped at the platform's own", async () => {
    const fetchMock = vi.fn(async () => tokenResponse([{ id: "acct-a" }]));
    globalThis.fetch = fetchMock as any;

    await mintAccountTokens({
      host: HOST,
      implicitToken: IMPLICIT,
      credential: { accountToken: "held-token" },
      limit: 500,
      offset: 200,
    });

    const [url] = fetchMock.mock.calls[0] as any;
    expect(String(url)).toContain(`page[limit]=${ACCOUNT_PAGE_LIMIT_MAX}`);
    expect(String(url)).toContain("page[offset]=200");
  });

  it("reports an unreachable Elastic Path rather than throwing raw", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;

    await expect(
      mintAccountTokens({
        host: HOST,
        implicitToken: IMPLICIT,
        credential: { accountToken: "held-token" },
      })
    ).rejects.toBeInstanceOf(EpAccountTokenError);
  });
});

describe("findAccountToken", () => {
  it("finds a target that only appears on a later page", async () => {
    const pages = [
      tokenResponse(
        Array.from({ length: 100 }, (_, i) => ({ id: `acct-${i}` })),
        150
      ),
      tokenResponse(
        Array.from({ length: 50 }, (_, i) => ({ id: `acct-${i + 100}` })),
        150
      ),
    ];
    let call = 0;
    globalThis.fetch = vi.fn(async () => pages[call++]) as any;

    const found = await findAccountToken({
      host: HOST,
      implicitToken: IMPLICIT,
      accountToken: "held-token",
      accountId: "acct-120",
    });

    expect(found.entry?.token).toBe("token-for-acct-120");
    expect(call).toBe(2);
  });

  it("stops at the reported total rather than paging forever", async () => {
    const fetchMock = vi.fn(async () =>
      tokenResponse([{ id: "acct-a" }, { id: "acct-b" }])
    );
    globalThis.fetch = fetchMock as any;

    const found = await findAccountToken({
      host: HOST,
      implicitToken: IMPLICIT,
      accountToken: "held-token",
      accountId: "acct-missing",
    });

    expect(found.entry).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("toAccountRoster", () => {
  it("strips the credential off every entry", () => {
    const roster = toAccountRoster([
      { id: "acct-a", name: "Acme", token: "secret", expires: 1 },
    ]);
    expect(roster).toEqual([{ id: "acct-a", name: "Acme" }]);
    expect(JSON.stringify(roster)).not.toContain("secret");
  });
});

describe("page bounds", () => {
  it("defaults and caps the limit at the platform's own maximum", () => {
    expect(clampAccountPageLimit(undefined)).toBe(ACCOUNT_PAGE_LIMIT_MAX);
    expect(clampAccountPageLimit(101)).toBe(ACCOUNT_PAGE_LIMIT_MAX);
    expect(clampAccountPageLimit(25)).toBe(25);
    expect(clampAccountPageLimit(0)).toBe(ACCOUNT_PAGE_LIMIT_MAX);
  });

  it("floors the offset at the first page", () => {
    expect(clampAccountPageOffset(undefined)).toBe(0);
    expect(clampAccountPageOffset(-5)).toBe(0);
    expect(clampAccountPageOffset(30)).toBe(30);
  });
});
