import { useCallback, useMemo } from "react";
import { DEFAULT_LOCALE } from "../utils/field-format";
import type { CurrencyDisplay, FormattedPrice } from "../utils/price";
import { formatMinor, formatPrice } from "../utils/price";
import { useEpCommerce } from "./EpCommerceContext";

export interface MoneyFormat {
  /** An amount that only ever arrived as minor units — a session total, a rate. */
  minor: (amount: number, currency: string) => string;
  /** A complete Elastic Path price. */
  price: (price: FormattedPrice | undefined) => string;
}

/**
 * The provider's money formatting, bound once.
 *
 * `currencyDisplay` and `locale` are ordinary bindable props on
 * `EpCommerceProvider`, so a designer can wire a currency or locale switcher to
 * them. A memo that formats money inside its own body closes over both values
 * without depending on them, and stays stale until unrelated data forces a
 * recompute; depending on this callback instead is a dependency the memo cannot
 * silently omit.
 */
export function useMoneyFormat(): MoneyFormat {
  const commerce = useEpCommerce();
  const currencyDisplay: CurrencyDisplay =
    commerce?.currencyDisplay ?? "platform";
  const locale = commerce?.locale ?? DEFAULT_LOCALE;

  const minor = useCallback(
    (amount: number, currency: string) =>
      formatMinor(amount, currency, currencyDisplay, locale),
    [currencyDisplay, locale]
  );

  const price = useCallback(
    (value: FormattedPrice | undefined) =>
      formatPrice(value, currencyDisplay, locale),
    [currencyDisplay, locale]
  );

  return useMemo(() => ({ minor, price }), [minor, price]);
}
