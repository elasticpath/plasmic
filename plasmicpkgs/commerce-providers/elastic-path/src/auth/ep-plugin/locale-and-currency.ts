import type {
  EpLocaleAndCurrency,
  EpLocaleAndCurrencyResolver,
} from "../../types/locale-and-currency";

const CURRENCY = /^[A-Za-z]{3}$/;

const intl = Intl as typeof Intl & {
  getCanonicalLocales(locale: string): string[];
};

const Q_VALUE = /^q=(0(\.\d{0,3})?|1(\.0{0,3})?)$/i;

function canonicalTag(tag: string): string | undefined {
  try {
    return intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

function canonicalLocale(value: string): string | null | undefined {
  const ranges: Array<{ tag: string; q: number }> = [];
  for (const part of value.split(",")) {
    const [tag, ...params] = part.split(";").map((s) => s.trim());
    if (!tag) continue;
    let q = 1;
    const weight = params.find((p) => /^q=/i.test(p));
    if (weight !== undefined) {
      if (!Q_VALUE.test(weight)) continue;
      q = Number(weight.slice(2));
    }
    if (q > 0) ranges.push({ tag, q });
  }
  ranges.sort((a, b) => b.q - a.q);
  const wanted = ranges.filter((r) => r.tag !== "*");
  for (const { tag } of wanted) {
    const out = canonicalTag(tag);
    if (out) return out;
  }
  return wanted.length ? undefined : null;
}

function canonicalCurrency(value: string): string | undefined {
  return CURRENCY.test(value) ? value.toUpperCase() : undefined;
}

const warned = new Set<string>();

export function resetEpLocaleAndCurrencyWarnings(): void {
  warned.clear();
}

function accepted(
  value: unknown,
  canonical: (value: string) => string | null | undefined,
  name: "locale" | "currency"
): string | undefined {
  if (value == null || value === "") return undefined;
  const out = typeof value === "string" ? canonical(value) : undefined;
  if (out) return out;
  if (out === null || warned.has(name)) return undefined;
  warned.add(name);
  console.warn(
    `[ep-commerce] resolveLocaleAndCurrency returned an unusable ${name} ${JSON.stringify(
      value
    )}; it is not sent to Elastic Path. This warning is not repeated.`
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
