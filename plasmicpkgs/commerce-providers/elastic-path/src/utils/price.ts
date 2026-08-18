import type { FormattedPrice as EpFormattedPrice } from "@epcc-sdk/sdks-shopper";
import { DEFAULT_CURRENCY_CODE } from "../const";
import { DEFAULT_LOCALE } from "./field-format";

/**
 * An Elastic Path price with every field present.
 *
 * EP ships `float_price` on product prices and omits it on cart and line
 * prices; `formatted` is occasionally absent too. Consumers should not have to
 * know which, so the package completes both.
 */
export type FormattedPrice = Required<EpFormattedPrice>;

const exponents = new Map<string, number>();

/**
 * Digits in the currency's minor unit — 2 for USD, 0 for JPY, 3 for KWD.
 *
 * Read off Intl's own currency data rather than hardcoded, because the
 * `amount / 100` this replaces renders every zero-decimal price 100x too small.
 * Locale-independent: the fraction digits come from the currency.
 */
function minorUnitExponent(currency: string): number {
  const cached = exponents.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  exponents.set(currency, digits);
  return digits;
}

/** The decimal value of an integer amount in the currency's lowest denomination. */
export function toDecimal(amount: number, currency: string): number {
  return amount / 10 ** minorUnitExponent(currency);
}

/** Completes an EP price, filling only what EP left out. */
export function completePrice(
  price: EpFormattedPrice | undefined | null
): FormattedPrice | undefined {
  if (!price) return undefined;
  const currency = price.currency || DEFAULT_CURRENCY_CODE;
  const amount = price.amount ?? 0;
  const float_price = price.float_price ?? toDecimal(amount, currency);
  return {
    amount,
    currency,
    float_price,
    formatted: price.formatted ?? intlFormat(float_price, currency),
  };
}

function intlFormat(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}
