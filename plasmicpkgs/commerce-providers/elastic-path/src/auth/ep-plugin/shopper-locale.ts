export interface ShopperLocale {
  locale?: string;
  currency?: string;
}

type ShopperLocaleResolver = (request: {
  cookies: Record<string, string>;
  headers: Record<string, string>;
}) =>
  | ShopperLocale
  | null
  | undefined
  | Promise<ShopperLocale | null | undefined>;

const LOCALE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const CURRENCY = /^[A-Za-z]{3}$/;

function accepted(
  value: unknown,
  pattern: RegExp,
  name: string
): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string" && pattern.test(value)) return value;
  console.error(
    `[ep-commerce] resolveLocale returned an invalid ${name} ${JSON.stringify(
      value
    )}; it is not sent to Elastic Path`
  );
  return undefined;
}

/**
 * Every session read goes through here, so a server render and a proxied
 * browser call send the same `Accept-Language` and `X-Moltin-Currency`.
 */
export async function resolveShopperLocale(
  resolver: ShopperLocaleResolver | undefined,
  request: {
    cookies: Record<string, string>;
    headers?: Record<string, string>;
  }
): Promise<ShopperLocale> {
  if (!resolver) return {};
  let resolved: ShopperLocale | null | undefined;
  try {
    resolved = await resolver({
      cookies: request.cookies,
      headers: request.headers ?? {},
    });
  } catch (err) {
    console.error("[ep-commerce] resolveLocale threw", err);
    return {};
  }
  const out: ShopperLocale = {};
  const locale = accepted(resolved?.locale, LOCALE, "locale");
  const currency = accepted(resolved?.currency, CURRENCY, "currency");
  if (locale) out.locale = locale;
  if (currency) out.currency = currency.toUpperCase();
  return out;
}
