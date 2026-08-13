import { describe, expect, it, vi } from "vitest";

const handlerCalls: Request[] = [];
let nextResponse: Response;

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: async (request: Request) => {
      handlerCalls.push(request);
      return nextResponse;
    },
    POST: async (request: Request) => {
      handlerCalls.push(request);
      return nextResponse;
    },
  }),
}));

import { createEpAuthRoutes } from "../auth-routes";

const SESSION_BODY = {
  session: {
    id: "sess-1",
    token: "opaque-session-token",
    epAccessToken: "e1978208e412a8cc33be0f2706e72409d00f6758",
    epClientId: "public-client-id",
    epHost: "https://api.test.elasticpath.com",
    epCartId: "63b53d4f-d88a-48b3-b416-8cb1470aad8d",
  },
  user: { id: "anon-1" },
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const routes = () => createEpAuthRoutes({} as any);

describe("createEpAuthRoutes", () => {
  it("strips the EP access token from /get-session", async () => {
    nextResponse = jsonResponse(SESSION_BODY);

    const res = await routes().GET(
      new Request("http://localhost:3456/api/ep/get-session")
    );
    const body = await res.json();

    expect(body.session.epAccessToken).toBeUndefined();
    expect(body.session.epClientId).toBeUndefined();
    expect(body.session.epHost).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SESSION_BODY.session.epAccessToken);
  });

  it("keeps epCartId and the rest of the session", async () => {
    nextResponse = jsonResponse(SESSION_BODY);

    const res = await routes().GET(
      new Request("http://localhost:3456/api/ep/get-session")
    );
    const body = await res.json();

    expect(body.session.epCartId).toBe(SESSION_BODY.session.epCartId);
    expect(body.session.id).toBe("sess-1");
    expect(body.user).toEqual({ id: "anon-1" });
  });

  it("leaves non-get-session routes untouched", async () => {
    nextResponse = jsonResponse(SESSION_BODY);

    const res = await routes().POST(
      new Request("http://localhost:3456/api/ep/ep/anonymous", {
        method: "POST",
      })
    );
    const body = await res.json();

    expect(body.session.epAccessToken).toBe(SESSION_BODY.session.epAccessToken);
  });

  it("preserves Set-Cookie headers through redaction", async () => {
    nextResponse = jsonResponse(SESSION_BODY, {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "better-auth.session_token=abc; HttpOnly; Path=/",
      },
    });

    const res = await routes().GET(
      new Request("http://localhost:3456/api/ep/get-session")
    );

    expect(res.headers.get("Set-Cookie")).toContain("better-auth.session_token");
  });

  it("passes through a null session without throwing", async () => {
    nextResponse = jsonResponse({ session: null, user: null });

    const res = await routes().GET(
      new Request("http://localhost:3456/api/ep/get-session")
    );

    expect(await res.json()).toEqual({ session: null, user: null });
  });

  it("passes through a non-JSON body untouched", async () => {
    nextResponse = new Response("not json", { status: 200 });

    const res = await routes().GET(
      new Request("http://localhost:3456/api/ep/get-session")
    );

    expect(await res.text()).toBe("not json");
  });
});
