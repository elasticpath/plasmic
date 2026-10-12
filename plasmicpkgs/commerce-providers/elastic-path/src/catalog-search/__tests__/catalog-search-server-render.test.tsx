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

jest.mock("next/navigation.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createContext } = require("react");
  return {
    ServerInsertedHTMLContext: createContext(null),
    usePathname: () => "/category/boots",
    useSearchParams: () => new URLSearchParams(""),
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

jest.mock("@plasmicapp/host", () => ({
  DataProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  usePlasmicCanvasContext: () => null,
}));

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
const { useHits } = require("react-instantsearch");
const { EPCatalogSearchProvider } =
  require("../EPCatalogSearchProvider") as typeof import("../EPCatalogSearchProvider");
const { SERVER_SEARCH_TIMEOUT_MS } =
  require("../multi-search-client") as typeof import("../multi-search-client");

const BRIDGE_KEY = Symbol.for("@elasticpath/ep-request-bridge");
const SLOT = 'Symbol.for("@elasticpath/ep-catalog-search-initial-results")';

const AUTH = {
  accessToken: "server-token",
  host: "https://api.ep.test",
  clientId: "client-1",
};

function searchResult(names: string[]) {
  return {
    hits: names.map((name, i) => ({
      document: { id: `${name}-${i}`, name },
    })),
    found: names.length,
    out_of: names.length,
    page: 1,
    request_params: { per_page: 12, q: "*" },
    search_time_ms: 1,
    facet_counts: [],
  };
}

const fetchMock = jest.fn();

function answerSearches(namesFor: (filterBy: string) => string[]) {
  fetchMock.mockImplementation(async (input: Request | string, init?: any) => {
    const body = JSON.parse(
      typeof input === "string" ? init.body : await input.clone().text()
    );
    return new Response(
      JSON.stringify({
        results: body.searches.map((s: any) =>
          searchResult(namesFor(String(s.filter_by ?? "")))
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

beforeEach(() => {
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
    expect(hitNamesIn(slot[keys[0]])).toEqual(["Trail Boot"]);
    expect(hitNamesIn(slot[keys[1]])).toEqual(["Sun Hat"]);
  });
});

describe("a server pass that cannot search", () => {
  // Nothing, as in the browser's first render before InstantSearch starts.
  function expectBrowserFallback({ html, inserted, errors }: ServerRender) {
    expect(errors).toEqual([]);
    expect(html).toBe("<main></main>");
    expect(inserted).not.toContain("<script");
  }

  const page = (
    <EPCatalogSearchProvider baseFilter="categories:=boots">
      <HitNames />
    </EPCatalogSearchProvider>
  );

  it("renders without results when the search fails", async () => {
    installBridge();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ status: 500 }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );

    expectBrowserFallback(await serverRender(page));
  });

  it("renders without results when the response carries none", async () => {
    installBridge();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    expectBrowserFallback(await serverRender(page));
  });

  it("renders without results when the search outlasts the timeout", async () => {
    jest.useFakeTimers({
      doNotFake: ["setImmediate", "nextTick", "queueMicrotask"],
    });
    try {
      installBridge();
      fetchMock.mockReturnValue(new Promise(() => {}));

      const rendering = serverRender(page);
      await jest.advanceTimersByTimeAsync(SERVER_SEARCH_TIMEOUT_MS);

      expectBrowserFallback(await rendering);
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders without results when the storefront registered no bridge", async () => {
    answerSearches(() => ["Trail Boot"]);

    expectBrowserFallback(await serverRender(page));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders without results when the request has no session", async () => {
    installBridge({ requestSession: async () => null });
    answerSearches(() => ["Trail Boot"]);

    expectBrowserFallback(await serverRender(page));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders without results outside the App Router, where next/headers throws", async () => {
    mockNextRequest.inScope = false;
    installBridge();
    answerSearches(() => ["Trail Boot"]);

    expectBrowserFallback(await serverRender(page, { insertContext: false }));
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
  tree: React.ReactElement
) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://shop.test/category/boots",
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
      dom.window.close();
    },
  };
}

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
