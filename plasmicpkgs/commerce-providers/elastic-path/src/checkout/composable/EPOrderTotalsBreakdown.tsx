/**
 * EPOrderTotalsBreakdown — exposes financial totals for the checkout.
 *
 * Reads from `checkoutData.summary` (inside EPCheckoutProvider) or falls
 * back to `cart` (inside EPCheckoutCartSummary). Designer binds any
 * elements to individual fields like subtotalFormatted, taxFormatted,
 * shippingFormatted, totalFormatted.
 */
import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { MOCK_ORDER_TOTALS_DATA } from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";
import type { Cart } from "../../types/cart";
import { useMoneyFormat } from "../../shopper-context/use-money-format";

const log = createLogger("EPOrderTotalsBreakdown");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "withData";

interface EPOrderTotalsBreakdownProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

interface OrderTotalsData {
  subtotal: number;
  subtotalFormatted: string;
  tax: number;
  taxFormatted: string;
  shipping: number;
  shippingFormatted: string;
  discount: number;
  discountFormatted: string;
  hasDiscount: boolean;
  total: number;
  totalFormatted: string;
  currency: string;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EPOrderTotalsBreakdown(props: EPOrderTotalsBreakdownProps) {
  const money = useMoneyFormat();
  const { children, className, previewState = "auto" } = props;

  // Priority: checkoutData.summary (EPCheckoutProvider) > checkoutSession.totals > cart > mock
  const checkoutData = useSelector("checkoutData") as
    | { summary?: OrderTotalsData }
    | undefined;
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | { session?: { totals?: { subtotal?: number; tax?: number; shipping?: number; total?: number; currency?: string } } }
    | undefined;
  const checkoutCart = useSelector("cart") as Cart | undefined;

  const inEditor = !!usePlasmicCanvasContext();

  const composableSummary = checkoutData?.summary;
  const sessionTotals = checkoutSessionCtx?.session?.totals;

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !composableSummary && !sessionTotals && !checkoutCart && inEditor);

  const totalsData = useMemo<OrderTotalsData>(() => {
    if (useMock) {
      log.debug("Using mock order totals for design-time preview");
      return MOCK_ORDER_TOTALS_DATA;
    }

    // Source 1: checkoutData.summary (from EPCheckoutProvider).
    // An all-zero summary next to a cart that has money in it is not an answer
    // — it is a provider that has nothing to report yet, so fall through to the
    // cart rather than showing the shopper a $0.00 order.
    if (composableSummary) {
      const summaryIsEmpty = !composableSummary.total && !composableSummary.subtotal;
      const cartHasMoney = !!checkoutCart?.meta?.display_price?.with_tax?.amount;
      if (!summaryIsEmpty || !cartHasMoney) {
        log.debug("Using checkoutData.summary from EPCheckoutProvider");
        return composableSummary;
      }
      log.debug("checkoutData.summary is empty; falling through to cart totals");
    }

    // Source 2: checkoutSession.totals (from EPCheckoutSessionProvider)
    if (sessionTotals) {
      const cur = (sessionTotals.currency ?? "USD").toUpperCase();
      const fmt = (minor: number) => money.minor(minor, cur);
      return {
        subtotal: sessionTotals.subtotal ?? 0,
        subtotalFormatted: fmt(sessionTotals.subtotal ?? 0),
        tax: sessionTotals.tax ?? 0,
        taxFormatted: fmt(sessionTotals.tax ?? 0),
        shipping: sessionTotals.shipping ?? 0,
        shippingFormatted: sessionTotals.shipping != null ? fmt(sessionTotals.shipping) : "TBD",
        discount: 0,
        discountFormatted: fmt(0),
        hasDiscount: false,
        total: sessionTotals.total ?? 0,
        totalFormatted: fmt(sessionTotals.total ?? 0),
        currency: cur,
        itemCount: 0,
      };
    }

    // Source 3: the cart published by EPCheckoutCartSummary
    if (checkoutCart) {
      const price = checkoutCart.meta?.display_price;
      const discount = price?.discount?.amount ?? 0;
      return {
        subtotal: price?.without_tax?.amount ?? 0,
        subtotalFormatted: money.price(price?.without_tax),
        tax: price?.tax?.amount ?? 0,
        taxFormatted: money.price(price?.tax),
        shipping: price?.shipping?.amount ?? 0,
        shippingFormatted: price?.shipping
          ? money.price(price.shipping)
          : "TBD",
        discount,
        discountFormatted: money.price(price?.discount),
        hasDiscount: discount !== 0,
        total: price?.with_tax?.amount ?? 0,
        totalFormatted: money.price(price?.with_tax),
        currency: price?.without_tax?.currency ?? "USD",
        itemCount: checkoutCart.itemCount,
      };
    }

    // Fallback — outside providers, non-production warning
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      log.warn("EPOrderTotalsBreakdown used outside both EPCheckoutSessionProvider and EPCheckoutCartSummary — using mock data");
    }
    return MOCK_ORDER_TOTALS_DATA;
  }, [useMock, composableSummary, sessionTotals, checkoutCart, money]);

  return (
    <DataProvider name="orderTotalsData" data={totalsData}>
      <div className={className} data-ep-order-totals-breakdown="">
        {children ?? (
          // The default used to be four rows of the literal text "$0.00" — a
          // page that looks priced and isn't. These read the real figures.
          <div data-ep-totals-rows="">
            {[
              { label: "Subtotal", value: totalsData.subtotalFormatted },
              { label: "Shipping", value: totalsData.shippingFormatted },
              { label: "Tax", value: totalsData.taxFormatted },
              ...(totalsData.hasDiscount
                ? [{ label: "Discount", value: totalsData.discountFormatted }]
                : []),
              { label: "Total", value: totalsData.totalFormatted },
            ].map((row) => (
              <div key={row.label} data-ep-totals-row="">
                <span data-ep-totals-label="">{row.label}</span>
                <span data-ep-totals-value="">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </DataProvider>
  );
}

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epOrderTotalsBreakdownMeta: CodeComponentMeta<EPOrderTotalsBreakdownProps> =
  {
    name: "plasmic-commerce-ep-order-totals-breakdown",
    displayName: "EP Order Totals Breakdown",
    description:
      "Exposes financial totals (subtotal, tax, shipping, discount, total) from checkout or cart context. Bind any elements to the totals data.",
    props: {
      children: {
        type: "slot",
        description:
          "Optional. Leave empty for the default rows; fill it to compose your own against orderTotalsData.",
        hidePlaceholder: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPOrderTotalsBreakdown",
    providesData: true,
  };

export function registerEPOrderTotalsBreakdown(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPOrderTotalsBreakdownProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPOrderTotalsBreakdown,
    customMeta ?? epOrderTotalsBreakdownMeta
  );
}
