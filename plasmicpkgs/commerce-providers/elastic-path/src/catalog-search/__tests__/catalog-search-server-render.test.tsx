/**
 * @jest-environment node
 *
 * The server pass of catalog search, rendered the way the Next.js App Router
 * renders a client component: React 19 (Next's own copy), a
 * `ServerInsertedHTMLContext` that collects inserted HTML, and the request
 * bridge the storefront's `createEpAuth` registers. The browser tests then
 * hydrate that HTML in a jsdom window, as a shopper's browser would.
 */
import { Writable } from "stream";

jest.mock("react", () => jest.requireActual("next/dist/compiled/react"));
jest.mock("react/jsx-runtime", () =>
  jest.requireActual("next/dist/compiled/react/jsx-runtime")
);
jest.mock("react-dom", () =>
  jest.requireActual("next/dist/compiled/react-dom")
);
jest.mock("react-dom/server", () =>
  jest.requireActual("next/dist/compiled/react-dom/server.node")
);
jest.mock("react-dom/client", () =>
  jest.requireActual("next/dist/compiled/react-dom/client")
);

const mockPageUrl = { search: "" };
jest.mock("next/navigation.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createContext } = require("react");
  return {
    ServerInsertedHTMLContext: createContext(null),
    usePathname: () => "/category/boots",
    useSearchParams: () => new URLSearchParams(mockPageUrl.search),
    useParams: () => ({}),
  };
});

// Outside the App Router, Next's own `headers()` throws.
const mockNextRequest = { inScope: true };
jest.mock("next/headers.js", () => ({
  headers: () => {
    if (!mockNextRequest.inScope) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return new Headers();
  },
}));

jest.mock("@plasmicapp/host", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createContext, createElement, useContext } = require("react");
  const PageData = createContext({});
  return {
    DataProvider: (props: {
      name: string;
      data: unknown;
      children: React.ReactNode;
    }) =>
      createElement(
        PageData.Provider,
        { value: { ...useContext(PageData), [props.name]: props.data } },
        props.children
      ),
    useSelector: (name: string) => useContext(PageData)[name],
    usePlasmicCanvasContext: () => null,
    repeatedElement: (_index: number, children: React.ReactNode) => children,
  };
});

jest.mock("@plasmicapp/host/registerComponent", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const React = require("react") as typeof import("react");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToPipeableStream, renderToStaticMarkup } =
  require("react-dom/server") as typeof import("react-dom/server") & {
    renderToPipeableStream: any;
  };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hydrateRoot } = require("react-dom/client");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require("jsdom");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ServerInsertedHTMLContext } = require("next/navigation.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useHits, useSearchBox } = require("react-instantsearch");
const { EPCatalogSearchProvider } =
  require("../EPCatalogSearchProvider") as typeof import("../EPCatalogSearchProvider");
const { EPSearchEmpty } =
  require("../EPSearchEmpty") as typeof import("../EPSearchEmpty");
const { EPRefinementList } =
  require("../EPRefinementList") as typeof import("../EPRefinementList");
const { EPSearchPagination } =
  require("../EPSearchPagination") as typeof import("../EPSearchPagination");
const { EPSearchHits } =
  require("../EPSearchHits") as typeof import("../EPSearchHits");
const { EPSearchInfiniteHits } =
  require("../EPSearchInfiniteHits") as typeof import("../EPSearchInfiniteHits");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useSelector } = require("@plasmicapp/host");
const { SERVER_SEARCH_TIMEOUT_MS } =
  require("../multi-search-client") as typeof import("../multi-search-client");

const BRIDGE_KEY = Symbol.for("@elasticpath/ep-request-bridge");
const SLOT = 'Symbol.for("@elasticpath/ep-catalog-search-initial-results")';

const AUTH = {
  accessToken: "server-token",
  host: "https://api.ep.test",
  clientId: "client-1",
};

const FACET_VALUES = ["Acme", "Zenith"];

/** Answers every facet the search asks for with `FACET_VALUES`. */
function searchResult(names: string[], facetBy = "") {
  return {
    hits: names.map((name, i) => ({
      document: { id: `${name}-${i}`, name },
    })),
    found: names.length,
    out_of: names.length,
    page: 1,
    request_params: { per_page: 12, q: "*" },
    search_time_ms: 1,
    facet_counts: facetBy
      .split(",")
      .filter(Boolean)
      .map((field) => ({
        field_name: field,
        counts: FACET_VALUES.map((value) => ({
          value,
          count: 1,
          highlighted: value,
        })),
        stats: {},
      })),
  };
}

const fetchMock = jest.fn();

async function requestBody(input: Request | string, init?: any) {
  return JSON.parse(
    typeof input === "string" ? init.body : await input.clone().text()
  );
}

/** Every search sent, in order. */
async function sentSearches(): Promise<any[]> {
  const bodies = await Promise.all(
    fetchMock.mock.calls.map(([input, init]) => requestBody(input, init))
  );
  return bodies.flatMap((body) => body.searches);
}

/** The `q` of every search sent, in order. */
async function searchedQueries(): Promise<string[]> {
  const bodies = await Promise.all(
    fetchMock.mock.calls.map(([input, init]) => requestBody(input, init))
  );
  return bodies.flatMap((body) => body.searches.map((s: any) => s.q));
}

function answerSearches(
  namesFor: (filterBy: string, query: string, search: any) => string[]
) {
  fetchMock.mockImplementation(async (input: Request | string, init?: any) => {
    const body = await requestBody(input, init);
    return new Response(
      JSON.stringify({
        results: body.searches.map((s: any) =>
          searchResult(
            namesFor(String(s.filter_by ?? ""), String(s.q ?? ""), s),
            String(s.facet_by ?? "")
          )
        ),
        included: {},
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

function installBridge(
  overrides: Partial<{
    requestSession: () => Promise<unknown>;
    requestNonce: () => Promise<string | undefined>;
  }> = {}
) {
  (globalThis as any)[BRIDGE_KEY] = {
    version: 1,
    requestSession: async () => AUTH,
    requestNonce: async () => "abc123",
    ...overrides,
  };
}

function HitNames() {
  const { hits } = useHits();
  return (
    <ul>
      {hits.map((hit: any) => (
        <li key={hit.objectID}>{hit.name}</li>
      ))}
    </ul>
  );
}

interface ServerRender {
  html: string;
  inserted: string;
  errors: unknown[];
}

/**
 * Puts `tree` inside a host element, as on any real page. React does not
 * check server nodes left over directly inside the root container, so a
 * mismatch at the top level would otherwise pass unseen.
 */
function onPage(tree: React.ReactElement) {
  return <main>{tree}</main>;
}

async function serverRender(
  tree: React.ReactElement,
  opts: { insertContext?: boolean } = {}
): Promise<ServerRender> {
  const callbacks: Array<() => React.ReactNode> = [];
  const errors: unknown[] = [];
  const page =
    opts.insertContext === false ? (
      onPage(tree)
    ) : (
      <ServerInsertedHTMLContext.Provider
        value={(cb: () => React.ReactNode) => callbacks.push(cb)}
      >
        {onPage(tree)}
      </ServerInsertedHTMLContext.Provider>
    );
  const html = await new Promise<string>((resolve, reject) => {
    let out = "";
    const sink = new Writable({
      write(chunk, _enc, done) {
        out += chunk.toString();
        done();
      },
      final(done) {
        resolve(out);
        done();
      },
    });
    const stream = renderToPipeableStream(page, {
      onAllReady() {
        stream.pipe(sink);
      },
      onShellError: reject,
      onError(error: unknown) {
        errors.push(error);
      },
    });
  });
  const inserted = renderToStaticMarkup(
    <>
      {callbacks.map((cb, i) => (
        <React.Fragment key={i}>{cb()}</React.Fragment>
      ))}
    </>
  );
  return { html, inserted, errors };
}

function scriptsIn(inserted: string): string[] {
  return [...inserted.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => body
  );
}

/** Runs the inserted scripts against a bare window and returns our slot. */
function slotContents(inserted: string): Record<string, any> {
  const fakeWindow: Record<symbol, any> = {};
  for (const body of scriptsIn(inserted)) {
    new Function("window", body)(fakeWindow);
  }
  return (
    fakeWindow[Symbol.for("@elasticpath/ep-catalog-search-initial-results")] ??
    {}
  );
}

function hitNamesIn(initialResults: any): string[] {
  return Object.values(initialResults).flatMap((index: any) =>
    index.results.flatMap((r: any) => r.hits.map((h: any) => h.name))
  );
}

function IdProbe() {
  return <span data-probe-id={React.useId()} />;
}

function SearchFor(props: { query: string }) {
  const { refine } = useSearchBox();
  return <button onClick={() => refine(props.query)}>search</button>;
}

beforeEach(() => {
  mockPageUrl.search = "";
  mockNextRequest.inScope = true;
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
  delete (globalThis as any)[BRIDGE_KEY];
});

describe("catalog search server pass", () => {
  it("renders the first page of results into the HTML", async () => {
    installBridge();
    answerSearches(() => ["Trail Boot", "Hiking Boot"]);

    const { html, inserted, errors } = await serverRender(
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <HitNames />
      </EPCatalogSearchProvider>
    );

    expect(errors).toEqual([]);
    expect(html).toContain("<li>Trail Boot</li>");
    expect(html).toContain("<li>Hiking Boot</li>");
    expect(inserted.match(/<script/g)).toHaveLength(1);
    expect(inserted).toContain(SLOT);
    expect(inserted).toContain('nonce="abc123"');
  });

  it("searches with the page request's session", async () => {
    installBridge();
    answerSearches(() => ["Trail Boot"]);

    await serverRender(
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <HitNames />
      </EPCatalogSearchProvider>
    );

    const request: Request = fetchMock.mock.calls[0][0];
    expect(new URL(request.url).origin).toBe(AUTH.host);
    expect(request.headers.get("authorization")).toBe("Bearer server-token");
  });

  it("renders the results for the search in the page URL", async () => {
    installBridge();
    mockPageUrl.search = "search%5Bquery%5D=shirt";
    answerSearches((_filterBy, query) =>
      query === "shirt" ? ["Linen Shirt"] : ["Trail Boot"]
    );

    const { html, errors } = await serverRender(
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <HitNames />
      </EPCatalogSearchProvider>
    );

    expect(errors).toEqual([]);
    expect(await searchedQueries()).toEqual(["shirt"]);
    expect(html).toContain("<li>Linen Shirt</li>");
  });

  it("keeps each provider's results apart on a page with two", async () => {
    installBridge();
    answerSearches((filterBy) =>
      filterBy.includes("hats") ? ["Sun Hat"] : ["Trail Boot"]
    );

    const { html, inserted } = await serverRender(
      <>
        <EPCatalogSearchProvider baseFilter="categories:=boots">
          <HitNames />
        </EPCatalogSearchProvider>
        <EPCatalogSearchProvider baseFilter="categories:=hats">
          <HitNames />
        </EPCatalogSearchProvider>
      </>
    );

    expect(html).toMatch(/Trail Boot[\s\S]*Sun Hat/);
    const slot = slotContents(inserted);
    const keys = Object.keys(slot);
    expect(keys).toHaveLength(2);
    expect(hitNamesIn(slot[keys[0]].results)).toEqual(["Trail Boot"]);
    expect(hitNamesIn(slot[keys[1]].results)).toEqual(["Sun Hat"]);
  });
});

describe("a server pass that cannot search", () => {
  const page = (
    <EPCatalogSearchProvider baseFilter="categories:=boots">
      <HitNames />
      <EPSearchEmpty>
        <p>No results found</p>
      </EPSearchEmpty>
    </EPCatalogSearchProvider>
  );

  /**
   * The HTML carries the widgets before any search, which the browser
   * hydrates and then searches through the storefront's own proxy.
   */
  async function expectBrowserSearch(rendered: ServerRender) {
    expect(rendered.errors).toEqual([]);
    expect(rendered.html).toContain("<ul></ul>");
    expect(rendered.html).not.toContain("No results found");
    expect(rendered.html).not.toContain("data-ep-catalog-search-error");

    fetchMock.mockReset();
    answerSearches(() => ["Trail Boot"]);
    const browser = await hydrateInBrowser(rendered, page);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/ep/proxy/multiSearch");
      expect(browser.container.innerHTML).toContain("<li>Trail Boot</li>");
    } finally {
      await browser.leave();
    }
  }

  it("leaves the search to the browser when the server's search fails", async () => {
    installBridge();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ status: 500 }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );

    await expectBrowserSearch(await serverRender(page));
  });

  it("leaves the search to the browser when the response carries no results", async () => {
    installBridge();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expectBrowserSearch(await serverRender(page));
  });

  it("leaves the search to the browser when the server's search outlasts the timeout", async () => {
    let rendered: ServerRender;
    jest.useFakeTimers({
      doNotFake: ["setImmediate", "nextTick", "queueMicrotask"],
    });
    try {
      installBridge();
      fetchMock.mockReturnValue(new Promise(() => {}));

      const rendering = serverRender(page);
      await jest.advanceTimersByTimeAsync(SERVER_SEARCH_TIMEOUT_MS);
      rendered = await rendering;
    } finally {
      jest.useRealTimers();
    }

    await expectBrowserSearch(rendered);
  });

  it("leaves the search to the browser when the storefront registered no bridge", async () => {
    answerSearches(() => ["Trail Boot"]);

    const rendered = await serverRender(page);
    expect(fetchMock).not.toHaveBeenCalled();
    await expectBrowserSearch(rendered);
  });

  it("leaves the search to the browser when the request has no session", async () => {
    installBridge({ requestSession: async () => null });
    answerSearches(() => ["Trail Boot"]);

    const rendered = await serverRender(page);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.inserted).toContain('nonce="abc123"');
    await expectBrowserSearch(rendered);
  });

  it("renders nothing outside the App Router, where next/headers throws", async () => {
    mockNextRequest.inScope = false;
    installBridge();
    answerSearches(() => ["Trail Boot"]);

    const { html, inserted, errors } = await serverRender(page, {
      insertContext: false,
    });
    expect(errors).toEqual([]);
    expect(html).toBe("<main></main>");
    expect(inserted).not.toContain("<script");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const BROWSER_GLOBALS = [
  "window",
  "document",
  "navigator",
  "history",
  "location",
  "HTMLElement",
  "HTMLIFrameElement",
  "Node",
  "Event",
] as const;

/**
 * Loads server-rendered HTML and its inserted scripts into a jsdom window,
 * makes that window the global one, and hydrates `tree` over the HTML.
 */
async function hydrateInBrowser(
  { html, inserted }: ServerRender,
  tree: React.ReactElement,
  opts: { url?: string } = {}
) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: opts.url ?? "http://shop.test/category/boots",
    runScripts: "outside-only",
  });
  const saved = BROWSER_GLOBALS.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  );
  for (const key of BROWSER_GLOBALS) {
    Object.defineProperty(globalThis, key, {
      value: key === "window" ? dom.window : dom.window[key],
      configurable: true,
      writable: true,
    });
  }
  const container = dom.window.document.createElement("div");
  container.innerHTML = html;
  dom.window.document.body.appendChild(container);
  for (const body of scriptsIn(inserted)) dom.window.eval(body);

  const hydrationErrors: unknown[] = [];
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      // The server renderer marks every context it rendered and never unmarks
      // it, which the client reads as a second renderer. Only one process
      // ever runs both, and that is this test.
      if (String(args[0]).includes("multiple renderers concurrently")) return;
      hydrationErrors.push(args);
    });
  const root = hydrateRoot(container, onPage(tree), {
    onRecoverableError: (error: unknown) => hydrationErrors.push(error),
  });
  await settle();
  return {
    container: container as HTMLElement,
    hydrationErrors,
    async leave() {
      root.unmount();
      await settle();
      consoleError.mockRestore();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
      openWindows.push(dom.window);
    },
  };
}

// The URL router writes 400 ms after the last change, unmounting included,
// and must find its window still open.
const openWindows: Array<{ close(): void }> = [];
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 450));
  for (const w of openWindows) w.close();
});

async function settle() {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("in the browser", () => {
  const page = (
    <EPCatalogSearchProvider baseFilter="categories:=boots">
      <HitNames />
    </EPCatalogSearchProvider>
  );

  it("hydrates the server's results without searching again", async () => {
    installBridge();
    answerSearches(() => ["Trail Boot"]);
    const rendered = await serverRender(page);
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, page);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(browser.container.innerHTML).toContain("<li>Trail Boot</li>");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await browser.leave();
    }
  });

  it("sends a search after hydration through the storefront's own origin", async () => {
    installBridge();
    answerSearches((_filterBy, query) =>
      query === "shirt" ? ["Linen Shirt"] : ["Trail Boot"]
    );
    const withSearch = (
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <SearchFor query="shirt" />
        <HitNames />
      </EPCatalogSearchProvider>
    );
    const rendered = await serverRender(withSearch);
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, withSearch);
    try {
      browser.container.querySelector("button")!.click();
      await settle();

      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/ep/proxy/multiSearch");
      expect(await searchedQueries()).toEqual(["shirt"]);
      expect(browser.container.innerHTML).toContain("<li>Linen Shirt</li>");
    } finally {
      await browser.leave();
    }
  });

  it("hydrates each of two providers from its own results", async () => {
    installBridge();
    answerSearches((filterBy) =>
      filterBy.includes("hats") ? ["Sun Hat"] : ["Trail Boot"]
    );
    const twoProviders = (
      <>
        <section>
          <EPCatalogSearchProvider baseFilter="categories:=boots">
            <HitNames />
          </EPCatalogSearchProvider>
        </section>
        <section>
          <EPCatalogSearchProvider baseFilter="categories:=hats">
            <HitNames />
          </EPCatalogSearchProvider>
        </section>
      </>
    );
    const rendered = await serverRender(twoProviders);
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, twoProviders);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      const [boots, hats] = Array.from(
        browser.container.querySelectorAll("section")
      );
      expect(boots.innerHTML).toContain("<li>Trail Boot</li>");
      expect(boots.innerHTML).not.toContain("Sun Hat");
      expect(hats.innerHTML).toContain("<li>Sun Hat</li>");
      expect(hats.innerHTML).not.toContain("Trail Boot");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await browser.leave();
    }
  });

  it("searches through the storefront's own origin when the server did not", async () => {
    answerSearches(() => ["Trail Boot"]);
    const rendered = await serverRender(page);

    const browser = await hydrateInBrowser(rendered, page);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/ep/proxy/multiSearch");
      expect(browser.container.innerHTML).toContain("<li>Trail Boot</li>");
    } finally {
      await browser.leave();
    }
  });

  it("hydrates a page rendered outside the App Router, then searches through the proxy", async () => {
    mockNextRequest.inScope = false;
    answerSearches(() => ["Trail Boot"]);
    const withProbe = (
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <IdProbe />
        <HitNames />
      </EPCatalogSearchProvider>
    );
    const rendered = await serverRender(withProbe, { insertContext: false });
    expect(rendered.errors).toEqual([]);

    const browser = await hydrateInBrowser(rendered, withProbe);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/ep/proxy/multiSearch");
      expect(browser.container.innerHTML).toContain("<li>Trail Boot</li>");
    } finally {
      await browser.leave();
    }
  });
});

describe("widgets in the provider's slot", () => {
  it("serves and hydrates the page of results the URL asks for", async () => {
    installBridge();
    mockPageUrl.search = "search%5Bpage%5D=2";
    // Typesense pages count from 1; the URL's page 2 is its page 2.
    answerSearches((_filterBy, _query, search) =>
      search.page === 2 ? ["Page Two Boot"] : ["Page One Boot"]
    );
    const page = (
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <EPSearchPagination />
        <HitNames />
      </EPCatalogSearchProvider>
    );

    const rendered = await serverRender(page);
    expect(rendered.errors).toEqual([]);
    expect((await sentSearches()).map((s) => s.page)).toEqual([2]);
    expect(rendered.html).toContain("<li>Page Two Boot</li>");
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, page, {
      url: "http://shop.test/category/boots?search%5Bpage%5D=2",
    });
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(browser.container.innerHTML).toContain("<li>Page Two Boot</li>");
    } finally {
      await browser.leave();
    }
  });

  it("serves and hydrates a refinement list's facet values", async () => {
    installBridge();
    answerSearches(() => ["Trail Boot"]);
    const page = (
      <EPCatalogSearchProvider baseFilter="categories:=boots">
        <EPRefinementList attribute="brand" />
        <HitNames />
      </EPCatalogSearchProvider>
    );

    const rendered = await serverRender(page);
    expect(rendered.errors).toEqual([]);
    expect((await sentSearches()).map((s) => s.facet_by)).toEqual(["brand"]);
    expect(refinementLabels(rendered.html)).toEqual(FACET_VALUES);
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, page);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refinementLabels(browser.container.innerHTML)).toEqual(
        FACET_VALUES
      );
    } finally {
      await browser.leave();
    }
  });
});

function refinementLabels(html: string): string[] {
  return [...html.matchAll(/data-ep-refinement-label="">([^<]*)</g)].map(
    ([, label]) => label
  );
}

describe("an infinite listing", () => {
  const slugOf = (name: string) => name.toLowerCase().replace(/ /g, "-");

  /** Answers each search with the page of names it asks for. */
  function answerPages(pages: string[][]) {
    fetchMock.mockImplementation(
      async (input: Request | string, init?: any) => {
        const body = await requestBody(input, init);
        return new Response(
          JSON.stringify({
            results: body.searches.map((s: any) => {
              const page = s.page ?? 1;
              const names = pages[page - 1] ?? [];
              return {
                ...searchResult(names),
                hits: names.map((name) => ({
                  document: {
                    id: `${slugOf(name)}-id`,
                    name,
                    slug: slugOf(name),
                  },
                })),
                found: pages.flat().length,
                page,
                request_params: { per_page: s.per_page, q: s.q },
              };
            }),
            included: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    );
  }

  function ProductCard() {
    const product = useSelector("currentProduct");
    const hit = useSelector("currentHit");
    return <a href={hit.path}>{product.attributes.name}</a>;
  }

  function LoadMore() {
    const { isLastPage, loadMore } = useSelector("searchInfiniteHitsData");
    return isLastPage ? (
      <span>end of results</span>
    ) : (
      <button onClick={loadMore}>load more</button>
    );
  }

  const page = (
    <EPCatalogSearchProvider baseFilter="categories:=boots" hitsPerPage={2}>
      <EPSearchInfiniteHits loadMoreButton={<LoadMore />}>
        <ProductCard />
      </EPSearchInfiniteHits>
    </EPCatalogSearchProvider>
  );

  function cards(html: string): string[] {
    return [...html.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map(
      ([, href, name]) => `${name} ${href}`
    );
  }

  it("renders the first page of cards into the HTML, each linking to its product", async () => {
    installBridge();
    answerPages([
      ["Trail Boot", "Hiking Boot"],
      ["Snow Boot", "Rain Boot"],
    ]);

    const { html, errors } = await serverRender(page);

    expect(errors).toEqual([]);
    expect(cards(html)).toEqual([
      "Trail Boot /product/trail-boot",
      "Hiking Boot /product/hiking-boot",
    ]);
    expect(html).toContain("load more");
  });

  it("gives each card the same product and link as EP Search Hits", async () => {
    installBridge();
    answerPages([["Trail Boot", "Hiking Boot"]]);

    function FullCard() {
      const product = useSelector("currentProduct");
      const hit = useSelector("currentHit");
      const index = useSelector("currentProductIndex");
      return (
        <pre>{JSON.stringify({ product, path: hit.path, index })}</pre>
      );
    }

    const { html, errors } = await serverRender(
      <EPCatalogSearchProvider baseFilter="categories:=boots" hitsPerPage={2}>
        <section>
          <EPSearchHits productPathPrefix="/products">
            <FullCard />
          </EPSearchHits>
        </section>
        <section>
          <EPSearchInfiniteHits productPathPrefix="/products">
            <FullCard />
          </EPSearchInfiniteHits>
        </section>
      </EPCatalogSearchProvider>
    );

    expect(errors).toEqual([]);
    const [hits, infinite] = [
      ...html.matchAll(/<section>([\s\S]*?)<\/section>/g),
    ].map(([, section]) =>
      [...section.matchAll(/<pre>([^<]*)<\/pre>/g)].map(([, card]) => card)
    );
    expect(hits).toHaveLength(2);
    expect(infinite).toEqual(hits);
    expect(infinite[0]).toContain("&quot;path&quot;:&quot;/products/trail-boot&quot;");
  });

  it("tells the load-more button a single page of results is the last", async () => {
    installBridge();
    answerPages([["Trail Boot"]]);

    const { html, errors } = await serverRender(page);

    expect(errors).toEqual([]);
    expect(cards(html)).toEqual(["Trail Boot /product/trail-boot"]);
    expect(html).toContain("end of results");
    expect(html).not.toContain("load more");
  });

  it("appends the next page below the hydrated one when the shopper loads more", async () => {
    installBridge();
    answerPages([
      ["Trail Boot", "Hiking Boot"],
      ["Snow Boot", "Rain Boot"],
    ]);
    const rendered = await serverRender(page);
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, page);
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();

      browser.container.querySelector("button")!.click();
      await settle();

      expect((await sentSearches()).map((s) => s.page)).toEqual([2]);
      expect(cards(browser.container.innerHTML)).toEqual([
        "Trail Boot /product/trail-boot",
        "Hiking Boot /product/hiking-boot",
        "Snow Boot /product/snow-boot",
        "Rain Boot /product/rain-boot",
      ]);
      expect(browser.container.innerHTML).toContain("end of results");
      expect(browser.container.querySelector("button")).toBeNull();
    } finally {
      await browser.leave();
    }
  });

  it("serves the page a reloaded URL names, and loads the earlier ones above it", async () => {
    function LoadPrevious() {
      const { isFirstPage, loadPrevious } = useSelector(
        "searchInfiniteHitsData"
      );
      return isFirstPage ? null : (
        <button onClick={loadPrevious}>load previous</button>
      );
    }
    const reloaded = (
      <EPCatalogSearchProvider baseFilter="categories:=boots" hitsPerPage={2}>
        <EPSearchInfiniteHits
          loadPreviousButton={<LoadPrevious />}
          loadMoreButton={<LoadMore />}
        >
          <ProductCard />
        </EPSearchInfiniteHits>
      </EPCatalogSearchProvider>
    );
    installBridge();
    mockPageUrl.search = "search%5Bpage%5D=2";
    answerPages([
      ["Trail Boot", "Hiking Boot"],
      ["Snow Boot", "Rain Boot"],
    ]);

    const rendered = await serverRender(reloaded);
    expect(rendered.errors).toEqual([]);
    expect(cards(rendered.html)).toEqual([
      "Snow Boot /product/snow-boot",
      "Rain Boot /product/rain-boot",
    ]);
    expect(rendered.html).toContain("load previous");
    fetchMock.mockClear();

    const browser = await hydrateInBrowser(rendered, reloaded, {
      url: "http://shop.test/category/boots?search%5Bpage%5D=2",
    });
    try {
      expect(browser.hydrationErrors).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();

      browser.container.querySelector("button")!.click();
      await settle();

      expect((await sentSearches()).map((s) => s.page)).toEqual([1]);
      expect(cards(browser.container.innerHTML)).toEqual([
        "Trail Boot /product/trail-boot",
        "Hiking Boot /product/hiking-boot",
        "Snow Boot /product/snow-boot",
        "Rain Boot /product/rain-boot",
      ]);
      expect(browser.container.innerHTML).not.toContain("load previous");
    } finally {
      await browser.leave();
    }
  });
});
