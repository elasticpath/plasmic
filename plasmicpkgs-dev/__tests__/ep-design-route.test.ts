import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EP_HOST = "https://useast.api.elasticpath.com";

function bundleNaming(clientId: string) {
  return {
    bundle: {
      projects: [{ globalContextsProviderFileName: "global__proj.js" }],
      modules: {
        server: [
          {
            type: "code",
            fileName: "global__proj.js",
            code: `
function E(r){
  let e=$(),{children:s,commerceProviderComponentProps:o}=r;
  return g.createElement(e, {
    clientId:o&&"clientId"in o?o.clientId:"${clientId}",
    host:o&&"host"in o?o.host:"${EP_HOST}"
  });
}
`,
          },
        ],
      },
    },
  };
}

const { fetchPages, maybeFetchComponentData } = vi.hoisted(() => ({
  fetchPages: vi.fn(),
  maybeFetchComponentData: vi.fn(),
}));

vi.mock("../plasmic-init", () => ({
  PLASMIC: { fetchPages, maybeFetchComponentData },
}));

import { OPTIONS, POST } from "../app/api/ep/design/[fn]/route";

function post(fn: string, args: Record<string, unknown> = {}) {
  return [
    new Request(`http://localhost:3001/api/ep/design/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
    { params: Promise.resolve({ fn }) },
  ] as const;
}

let originalFetch: typeof fetch;
let now = Date.UTC(2026, 0, 1);

function mintedClientIds(): string[] {
  return (globalThis.fetch as any).mock.calls
    .filter(([url]: [unknown]) => String(url).endsWith("/oauth/access_token"))
    .map(([, init]: [unknown, RequestInit]) =>
      new URLSearchParams(String(init.body)).get("client_id")
    );
}

beforeEach(() => {
  now += 24 * 60 * 60 * 1000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  fetchPages.mockResolvedValue([{ path: "/products" }]);
  maybeFetchComponentData.mockResolvedValue(bundleNaming("bundle-client-id"));
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any) => {
    if (String(url) === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({ access_token: "implicit", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/api/ep/design/[fn] on the dev host", () => {
  it("mints its token against the store the Plasmic bundle names", async () => {
    await POST(...post("getSearchAttributes"));

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(url)).toBe(`${EP_HOST}/oauth/access_token`);
    expect(init.body).toContain("grant_type=implicit");
    expect(init.body).toContain("client_id=bundle-client-id");
  });

  it("reads the store from a project with no pages", async () => {
    fetchPages.mockResolvedValue([]);

    const res = await POST(...post("getSearchAttributes"));

    expect(res.status).toBe(200);
    expect(mintedClientIds()).toEqual(["bundle-client-id"]);
  });

  it("picks up a changed EP Provider without a restart", async () => {
    await POST(...post("getSearchAttributes"));
    maybeFetchComponentData.mockResolvedValue(bundleNaming("edited-client-id"));

    vi.setSystemTime(now + 60_000);
    await POST(...post("getSearchAttributes"));

    expect(mintedClientIds()).toEqual(["bundle-client-id", "edited-client-id"]);
  });

  it("reports a failed bundle fetch as itself and retries it", async () => {
    const loaderError = new Error("loader code fetch 500");
    maybeFetchComponentData.mockRejectedValueOnce(loaderError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const failed = await POST(...post("getSearchAttributes"));
    const retried = await POST(...post("getSearchAttributes"));

    expect(failed.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("dispatch_failed"),
      loaderError
    );
    expect(retried.status).toBe(200);
  });

  it("serves only the design functions", async () => {
    const res = await POST(...post("getCart"));

    expect(res.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("answers the CORS preflight", () => {
    expect(OPTIONS().status).toBe(204);
  });
});
