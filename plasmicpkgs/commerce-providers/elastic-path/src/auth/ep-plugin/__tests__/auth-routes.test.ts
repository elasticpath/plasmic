import { describe, expect, it, vi } from "vitest";

let nextResponse: Response;

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: async () => nextResponse,
    POST: async () => nextResponse,
  }),
}));

import { createEpAuthRoutes } from "../auth-routes";

const ACCESS_TOKEN = "e1978208e412a8cc33be0f2706e72409d00f6758";
const ACCOUNT_TOKEN = "account-management-token";
const CART_ID = "63b53d4f-d88a-48b3-b416-8cb1470aad8d";

const SESSION_BODY = {
  session: {
    id: "sess-1",
    userId: "anon-1",
    token: "better-auth-session-id",
    expiresAt: "2026-08-13T14:00:00.000Z",
    epAccessToken: ACCESS_TOKEN,
    epClientId: "public-client-id",
    epHost: "https://api.test.elasticpath.com",
    epAccountToken: ACCOUNT_TOKEN,
    epAccountId: "acct-1",
    epCartId: CART_ID,
    epExpires: 1786630149,
  },
  user: { id: "anon-1", email: "anon-1@anonymous.local" },
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const routes = () => createEpAuthRoutes({} as any);
const req = (path: string, method = "GET") =>
  new Request(`http://localhost:3456${path}`, { method });

// Every endpoint on this handler returns the session record, so the
// redaction is handler-wide rather than scoped to /get-session.
const SESSION_RETURNING_ROUTES = [
  ["GET", "/api/ep/get-session"],
  ["POST", "/api/ep/ep/anonymous"],
  ["POST", "/api/ep/ep/refresh"],
  ["POST", "/api/ep/ep/account/login"],
  ["POST", "/api/ep/ep/account/logout"],
  ["POST", "/api/ep/ep/cart"],
] as const;

describe("createEpAuthRoutes", () => {
  it.each(SESSION_RETURNING_ROUTES)(
    "withholds EP credentials from %s %s",
    async (method, path) => {
      nextResponse = jsonResponse(SESSION_BODY);
      const handler = method === "GET" ? routes().GET : routes().POST;

      const res = await handler(req(path, method));
      const text = await res.text();

      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain(ACCOUNT_TOKEN);

      const session = JSON.parse(text).session;
      expect(session.epAccessToken).toBeUndefined();
      expect(session.epAccountToken).toBeUndefined();
      expect(session.epClientId).toBeUndefined();
      expect(session.epHost).toBeUndefined();
    }
  );

  it("withholds unknown session fields by default", async () => {
    nextResponse = jsonResponse({
      session: { id: "sess-1", epSomeFutureCredential: "secret" },
    });

    const res = await routes().GET(req("/api/ep/get-session"));

    expect(await res.text()).not.toContain("secret");
  });

  it("keeps the fields the checkout components read", async () => {
    nextResponse = jsonResponse(SESSION_BODY);

    const res = await routes().GET(req("/api/ep/get-session"));
    const body = await res.json();

    expect(body.session.epCartId).toBe(CART_ID);
    expect(body.session.id).toBe("sess-1");
    expect(body.session.epExpires).toBe(1786630149);
    expect(body.user).toEqual(SESSION_BODY.user);
  });

  it("withholds the better-auth session id, which lives in an HttpOnly cookie", async () => {
    nextResponse = jsonResponse(SESSION_BODY);

    const res = await routes().GET(req("/api/ep/get-session"));

    expect((await res.json()).session.token).toBeUndefined();
  });

  it("preserves multiple Set-Cookie headers", async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", "better-auth.session_token=a; HttpOnly; Path=/");
    headers.append("Set-Cookie", "better-auth.session_data=b; HttpOnly; Path=/");
    nextResponse = jsonResponse(SESSION_BODY, { headers });

    const res = await routes().GET(req("/api/ep/get-session"));

    expect((res.headers as any).getSetCookie()).toHaveLength(2);
  });

  it("drops a stale Content-Length rather than overstating the body", async () => {
    const body = JSON.stringify(SESSION_BODY);
    nextResponse = jsonResponse(SESSION_BODY, {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(body.length),
      },
    });

    const res = await routes().GET(req("/api/ep/get-session"));
    const declared = res.headers.get("content-length");

    expect(declared === null || Number(declared) === (await res.text()).length).toBe(
      true
    );
  });

  it("passes through a non-2xx response untouched", async () => {
    nextResponse = jsonResponse({ error: "nope" }, { status: 401 });

    const res = await routes().GET(req("/api/ep/get-session"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "nope" });
  });

  it("passes through a null session without throwing", async () => {
    nextResponse = jsonResponse({ session: null, user: null });

    const res = await routes().GET(req("/api/ep/get-session"));

    expect(await res.json()).toEqual({ session: null, user: null });
  });

  it("passes through a non-JSON body untouched", async () => {
    nextResponse = new Response("not json", { status: 200 });

    const res = await routes().GET(req("/api/ep/get-session"));

    expect(await res.text()).toBe("not json");
  });
});
