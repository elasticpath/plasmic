import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EP_HOST = "https://useast.api.elasticpath.com";

const GLOBAL_CONTEXTS_MODULE = `
function E(r){
  let e=$(),{children:s,commerceProviderComponentProps:o}=r;
  return g.createElement(e, {
    clientId:o&&"clientId"in o?o.clientId:"bundle-client-id",
    host:o&&"host"in o?o.host:"${EP_HOST}"
  });
}
`;

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

beforeEach(() => {
  fetchPages.mockResolvedValue([{ path: "/products" }]);
  maybeFetchComponentData.mockResolvedValue({
    bundle: {
      projects: [{ globalContextsProviderFileName: "global__proj.js" }],
      modules: {
        server: [
          {
            type: "code",
            fileName: "global__proj.js",
            code: GLOBAL_CONTEXTS_MODULE,
          },
        ],
      },
    },
  });
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
  vi.restoreAllMocks();
});

describe("/api/ep/design/[fn] on the dev host", () => {
  it("mints its token against the store the Plasmic bundle names", async () => {
    await POST(...post("getSearchAttributes"));

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(String(url)).toBe(`${EP_HOST}/oauth/access_token`);
    expect(init.body).toContain("grant_type=implicit");
    expect(init.body).toContain("client_id=bundle-client-id");
    expect(maybeFetchComponentData).toHaveBeenCalledWith("/products");
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
