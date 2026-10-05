import { expect, Page, test } from "@playwright/test";

const USERNAME = process.env.EP_E2E_ACCOUNT_USERNAME;
const PASSWORD = process.env.EP_E2E_ACCOUNT_PASSWORD;
const LISTING_PATH = process.env.EP_E2E_LISTING_PATH ?? "/product-list";
const PRODUCT_PATH =
  process.env.EP_E2E_PRODUCT_PATH ??
  "/products/072541c8-1558-440b-979e-05b7880128fa";
const REFINE_QUERY = process.env.EP_E2E_REFINE_QUERY ?? "Sandle";
const ADD_PRODUCT =
  process.env.EP_E2E_ADD_PRODUCT ?? "3281ce38-87a7-488e-a113-9a6b2f616908";
const ADD_LOCATION = process.env.EP_E2E_ADD_LOCATION ?? "cat-smart";
const PRICED_SKU = process.env.EP_E2E_PRICED_SKU ?? "sandlesm";
const REVISIT_WAIT_MS = Number(process.env.EP_E2E_REVISIT_WAIT_MS ?? 0);

/** The window the envelope fell back to before it had a lifetime of its own. */
const OLD_ENVELOPE_WINDOW_MS = 5 * 60 * 1000;

const EXTRA_EP_HOSTS = (process.env.EP_E2E_EP_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

function isElasticPathHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return (
    /^[a-z0-9-]+\.api\.elasticpath\.com$/.test(hostname) ||
    hostname === "api.elasticpath.com" ||
    EXTRA_EP_HOSTS.includes(hostname)
  );
}

interface Replied {
  status: number;
  body: any;
}

/** Calls the storefront's own origin from inside the page, as a component does. */
function fromPage(page: Page, path: string, body?: unknown): Promise<Replied> {
  return page.evaluate(
    async ([url, payload]: [string, unknown]) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    [path, body ?? {}] as [string, unknown]
  );
}

function productPage(page: Page, input: unknown): Promise<Replied> {
  return fromPage(page, "/api/ep/proxy/getProductPage", input);
}

/** The listed price of one SKU, in minor units, as this shopper sees it. */
async function pricedAt(page: Page, sku: string): Promise<number> {
  const { body } = await productPage(page, {
    limit: 100,
    search: REFINE_QUERY,
  });
  const match = (body?.data ?? []).find(
    (product: any) => product?.attributes?.sku === sku
  );
  expect(match, `no product with sku ${sku} in the listing`).toBeTruthy();
  return match.meta.display_price.without_tax.amount;
}

async function cart(page: Page): Promise<any> {
  return (await fromPage(page, "/api/ep/proxy/getCart")).body;
}

test.describe("one shopper journey", () => {
  test.skip(
    !USERNAME || !PASSWORD,
    "needs EP_E2E_ACCOUNT_USERNAME / EP_E2E_ACCOUNT_PASSWORD for an account member in two accounts"
  );

  test("reaches Elastic Path only through the storefront's own origin", async ({
    page,
  }) => {
    const toElasticPath: string[] = [];
    page.on("request", (request) => {
      if (isElasticPathHost(request.url())) toElasticPath.push(request.url());
    });

    // 1 — a category page carries its products in the server-rendered HTML,
    // not only after hydration.
    const landing = await page.goto(LISTING_PATH);
    expect(await landing!.text()).toMatch(/href="\/products\//);
    await expect(page.locator("a[href^='/products/']").first()).toBeVisible();

    // 2 — refining the listing changes what is listed. The reference
    // storefront renders no refinement control, so the refinement is the one
    // the listing components make: a narrowed read through our own origin.
    const all = await productPage(page, { limit: 100 });
    const refined = await productPage(page, {
      limit: 100,
      search: REFINE_QUERY,
    });
    expect(refined.body.meta.results.total).toBeGreaterThan(0);
    expect(refined.body.meta.results.total).toBeLessThan(
      all.body.meta.results.total
    );

    const anonymousPrice = await pricedAt(page, PRICED_SKU);

    // 3 — the basket reflects an added line. The add names a stock location:
    // this store has multi-location inventory on, and the reference
    // storefront's add-to-cart button sends none, so every add is refused as
    // out of stock whatever this release does.
    await page.goto(PRODUCT_PATH);
    await expect(
      page.getByRole("button", { name: /add to cart/i }).first()
    ).toBeVisible();
    const added = await fromPage(page, "/api/ep/proxy/addCartItem", {
      productId: ADD_PRODUCT,
      quantity: 1,
      location: ADD_LOCATION,
    });
    expect(added.status).toBe(200);
    await expect
      .poll(async () => (await cart(page))?.itemCount ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const guestCart = (await cart(page)).id;
    expect(guestCart).toBeTruthy();

    // 4 — signing in lists both accounts and selects neither.
    const login = await fromPage(page, "/api/ep/ep/account/login", {
      username: USERNAME,
      password: PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.accounts.length).toBeGreaterThan(1);
    expect(login.body.session.epAccount ?? null).toBeNull();

    // 5 — selecting an account keeps the basket the shopper was looking at.
    const [first, second] = login.body.accounts;
    const selected = await fromPage(page, "/api/ep/ep/account/select", {
      accountId: first.id,
    });
    expect(selected.status).toBe(200);
    expect(selected.body.session.epAccount.id).toBe(first.id);
    expect((await cart(page)).id).toBe(guestCart);

    // 6 — switching account changes the price. The milestone's reason for
    // existing: an anonymous credential minted in the page can never carry an
    // account, so this reading was unreachable from the browser before.
    const firstPrice = await pricedAt(page, PRICED_SKU);
    await fromPage(page, "/api/ep/ep/account/select", { accountId: second.id });
    const secondPrice = await pricedAt(page, PRICED_SKU);
    expect([firstPrice, secondPrice]).not.toEqual([
      anonymousPrice,
      anonymousPrice,
    ]);

    // The switch leaves this shopper with no basket on the organisation they
    // moved to, so they fill one there before checking out.
    await fromPage(page, "/api/ep/proxy/addCartItem", {
      productId: ADD_PRODUCT,
      quantity: 1,
      location: ADD_LOCATION,
    });
    const accountCart = (await cart(page))?.id;
    expect(accountCart).toBeTruthy();

    // 7 — checkout still reaches payment.
    await page.goto("/checkout");
    await expect(
      page.locator("[data-ep-checkout-form-provider]").first()
    ).toBeVisible();
    await expect(page.locator("[data-ep-place-order]").first()).toBeVisible();

    // 8 — the session outlives the window the envelope used to fall back to.
    // Read off the cookie rather than waiting, so this stays a test; set
    // EP_E2E_REVISIT_WAIT_MS to wait for real.
    const sessionCookie = (await page.context().cookies()).find((c) =>
      c.name.includes("session_data")
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.expires * 1000 - Date.now()).toBeGreaterThan(
      OLD_ENVELOPE_WINDOW_MS
    );
    if (REVISIT_WAIT_MS > 0) await page.waitForTimeout(REVISIT_WAIT_MS);
    await page.goto(LISTING_PATH);
    expect((await cart(page))?.id).toBe(accountCart);

    expect(toElasticPath).toEqual([]);
  });
});
