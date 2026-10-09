import type {
  EpLocaleAndCurrency,
  EpLocaleAndCurrencyResolver,
} from "../../types/locale-and-currency";

const CURRENCY = /^[A-Za-z]{3}$/;

function canonicalLocale(value: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function canonicalCurrency(value: string): string | undefined {
  return CURRENCY.test(value) ? value.toUpperCase() : undefined;
}

function accepted(
  value: unknown,
  canonical: (value: string) => string | undefined,
  name: string
): string | undefined {
  if (value == null || value === "") return undefined;
  const out = typeof value === "string" ? canonical(value) : undefined;
  if (out) return out;
  console.error(
    `[ep-commerce] resolveLocaleAndCurrency returned an invalid ${name} ${JSON.stringify(
      value
    )}; it is not sent to Elastic Path`
  );
  return undefined;
}

async function pageRequestHeaders(): Promise<Record<string, string>> {
  try {
    const { headers } = await import("next/headers.js");
    return Object.fromEntries((await headers()).entries());
  } catch {
    return {};
  }
}

/**
 * Every session read goes through here, so a server render and a proxied
 * browser call send the same `Accept-Language` and `X-Moltin-Currency`. A
 * caller that passes no headers, such as a server render, gets the page
 * request's headers, as the proxy route passes its own.
 */
export async function resolveLocaleAndCurrency(
  resolver: EpLocaleAndCurrencyResolver | undefined,
  request: {
    cookies: Record<string, string>;
    headers?: Record<string, string>;
  }
): Promise<EpLocaleAndCurrency> {
  if (!resolver) return {};
  let resolved: EpLocaleAndCurrency | null | undefined;
  try {
    resolved = await resolver({
      cookies: request.cookies,
      headers: request.headers ?? (await pageRequestHeaders()),
    });
  } catch (err) {
    console.error("[ep-commerce] resolveLocaleAndCurrency threw", err);
    return {};
  }
  const out: EpLocaleAndCurrency = {};
  const locale = accepted(resolved?.locale, canonicalLocale, "locale");
  const currency = accepted(resolved?.currency, canonicalCurrency, "currency");
  if (locale) out.locale = locale;
  if (currency) out.currency = currency;
  return out;
}
