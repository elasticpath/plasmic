import { createCartRoutes } from "../server-routes";

const TRUSTED = ["http://localhost:3456", "https://*.vercel.app"];

function buildRoutes() {
  const getSession = jest.fn().mockResolvedValue({ session: null, cart: null });
  const epAuth = {
    api: { getSession },
    config: { trustedOrigins: TRUSTED },
  } as any;
  return { routes: createCartRoutes(epAuth), getSession };
}

function request(method: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3456/api/ep/cart/items", {
    method,
    headers,
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

describe("createCartRoutes origin gate", () => {
  it("lets safe methods through regardless of origin", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(
      request("GET", {
        Origin: "http://evil.test",
        "Sec-Fetch-Site": "cross-site",
      }),
      { params: Promise.resolve({ path: [] }) }
    );

    expect(res.status).not.toBe(403);
    expect(getSession).toHaveBeenCalled();
  });

  it("lets same-origin mutations through", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(
      request("POST", { "Sec-Fetch-Site": "same-origin" }),
      { params: Promise.resolve({ path: ["items"] }) }
    );

    expect(res.status).not.toBe(403);
    expect(getSession).toHaveBeenCalled();
  });

  it("lets cross-site mutations from a trusted origin through", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(
      request("POST", {
        "Sec-Fetch-Site": "cross-site",
        Origin: "https://preview.vercel.app",
      }),
      { params: Promise.resolve({ path: ["items"] }) }
    );

    expect(res.status).not.toBe(403);
    expect(getSession).toHaveBeenCalled();
  });

  it("rejects cross-site mutations from an untrusted origin before reading the session", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(
      request("POST", {
        "Sec-Fetch-Site": "cross-site",
        Origin: "http://evil.test",
      }),
      { params: Promise.resolve({ path: ["items"] }) }
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "untrusted_origin" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("rejects untrusted-origin deletes too", async () => {
    const { routes } = buildRoutes();
    const res = await routes.handle(
      request("DELETE", { Origin: "http://evil.test" }),
      { params: Promise.resolve({ path: ["items", "item-1"] }) }
    );

    expect(res.status).toBe(403);
  });

  it("still accepts a plain (non-promised) params object at runtime", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(request("GET"), {
      params: { path: [] },
    } as any);

    expect(res.status).not.toBe(403);
    expect(getSession).toHaveBeenCalled();
  });

  it("lets non-browser clients through when neither signal is present", async () => {
    const { routes, getSession } = buildRoutes();
    const res = await routes.handle(request("POST"), {
      params: Promise.resolve({ path: ["items"] }),
    });

    expect(res.status).not.toBe(403);
    expect(getSession).toHaveBeenCalled();
  });
});
