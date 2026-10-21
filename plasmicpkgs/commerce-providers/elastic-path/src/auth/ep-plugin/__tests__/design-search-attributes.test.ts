import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEpAuth } from "../create-ep-auth-better";
import {
  createEpDesignRoutes,
  resetEpDesignTokenCache,
} from "../design-routes";

const EP_HOST = "https://api.test.elasticpath.com";

type Search = Record<string, unknown>;
type Answer = (search: Search) => Record<string, unknown>;

let originalFetch: typeof fetch;
let searchesSent: Search[];
let answer: Answer;
let multiSearchStatus: number;

function facet(field_name: string, numeric = false) {
  return {
    field_name,
    counts: [{ value: "x", highlighted: "x", count: 1 }],
    stats: numeric ? { min: 0, max: 10, avg: 5, sum: 10, total_values: 1 } : { total_values: 1 },
  };
}

async function readRequest(input: any, init?: any) {
  if (typeof input === "string" || input instanceof URL) {
    return { url: String(input), body: init?.body ? String(init.body) : "" };
  }
  return { url: input.url as string, body: await input.clone().text() };
}

beforeEach(() => {
  resetEpDesignTokenCache();
  searchesSent = [];
  multiSearchStatus = 200;
  answer = () => ({ facet_counts: [], hits: [] });
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const { url, body } = await readRequest(input, init);
    if (url === `${EP_HOST}/oauth/access_token`) {
      return new Response(
        JSON.stringify({ access_token: "implicit", token_type: "Bearer", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.startsWith(`${EP_HOST}/pcm/catalog/multi-search`)) {
      const searches = (JSON.parse(body).searches ?? []) as Search[];
      searchesSent.push(...searches);
      if (multiSearchStatus !== 200) {
        return new Response(JSON.stringify({ errors: [{ status: "500" }] }), {
          status: multiSearchStatus,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ results: searches.map((s) => answer(s)) }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function getSearchAttributes() {
  const routes = createEpDesignRoutes(
    createEpAuth({
      clientId: "test-client-id",
      host: EP_HOST,
      secret: "x".repeat(48),
      baseURL: "http://localhost:3456",
    })
  );
  const res = await routes.handle(
    new Request("http://localhost:3456/api/ep/design/getSearchAttributes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ fn: "getSearchAttributes" }) }
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe("getSearchAttributes on the design-time route", () => {
  it("lists the store's facetable fields, flagging the numeric ones", async () => {
    answer = () => ({
      facet_counts: [
        facet("tags"),
        facet("meta.search.categories.lvl0"),
        facet("shopper_attributes.range"),
        facet("rating", true),
      ],
      hits: [],
    });

    const { status, body } = await getSearchAttributes();

    expect(status).toBe(200);
    expect(body).toEqual([
      { path: "meta.search.categories.lvl0", numeric: false },
      { path: "rating", numeric: true },
      { path: "shopper_attributes.range", numeric: false },
      { path: "tags", numeric: false },
    ]);
  });

  it("asks for every facet in one small search rather than a page of results", async () => {
    await getSearchAttributes();

    expect(searchesSent[0]).toMatchObject({ q: "*", facet_by: "*" });
    expect(searchesSent[0].max_facet_values).toBe(1);
  });

  it("names each key of a keyed field, which the store reports with the key dropped", async () => {
    answer = (search) => {
      if (search.facet_by === "*") {
        return {
          facet_counts: [
            facet("price.float_price", true),
            facet("price.amount", true),
            facet("price.float_price", true),
            facet("price.amount", true),
            facet("tags"),
          ],
          hits: [
            {
              document: {
                attributes: {
                  price: {
                    GBP: { amount: 23, includes_tax: false },
                    USD: { amount: 2000, includes_tax: false },
                  },
                },
              },
            },
          ],
        };
      }
      if (search.facet_by === "price.GBP.*" || search.facet_by === "price.USD.*") {
        return {
          facet_counts: [facet("price.float_price", true), facet("price.amount", true)],
          hits: [],
        };
      }
      return { facet_counts: [], hits: [] };
    };

    const { body } = await getSearchAttributes();

    expect(body).toEqual([
      { path: "price.GBP.amount", numeric: true },
      { path: "price.GBP.float_price", numeric: true },
      { path: "price.USD.amount", numeric: true },
      { path: "price.USD.float_price", numeric: true },
      { path: "tags", numeric: false },
    ]);
  });

  it("names the key of a keyed field a single-currency store reports once", async () => {
    answer = (search) => {
      if (search.facet_by === "*") {
        return {
          facet_counts: [facet("price.float_price", true)],
          hits: [{ document: { attributes: { price: { EUR: { amount: 5 } } } } }],
        };
      }
      if (search.facet_by === "price.EUR.*") {
        return { facet_counts: [facet("price.float_price", true)], hits: [] };
      }
      return { facet_counts: [], hits: [] };
    };

    const { body } = await getSearchAttributes();

    expect(body).toEqual([{ path: "price.EUR.float_price", numeric: true }]);
  });

  it("keeps a field whose path the products carry as written", async () => {
    answer = (search) =>
      search.facet_by === "*"
        ? {
            facet_counts: [facet("meta.search.categories.lvl0")],
            hits: [
              {
                document: {
                  meta: {
                    catalog_id: "c1",
                    search: { categories: { lvl0: ["Example"] } },
                  },
                },
              },
            ],
          }
        : { facet_counts: [], hits: [] };

    const { body } = await getSearchAttributes();

    expect(body).toEqual([{ path: "meta.search.categories.lvl0", numeric: false }]);
    expect(searchesSent).toHaveLength(1);
  });

  it("fails the request when the store's search fails, rather than listing nothing", async () => {
    multiSearchStatus = 500;

    const { status } = await getSearchAttributes();

    expect(status).toBe(500);
  });
});
