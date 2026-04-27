/**
 * EPOrderTotalsBreakdown — exposes financial totals for the checkout.
 *
 * Reads from `checkoutData.summary` (inside EPCheckoutProvider) or falls
 * back to `checkoutCartData` (inside EPCheckoutCartSummary). Designer
 * binds any elements to individual fields like subtotalFormatted,
 * taxFormatted, shippingFormatted, totalFormatted.
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
  const { children, className, previewState = "auto" } = props;

  // Priority: checkoutData.summary (EPCheckoutProvider) > checkoutSession.totals > checkoutCartData > mock
  const checkoutData = useSelector("checkoutData") as
    | { summary?: OrderTotalsData }
    | undefined;
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | { session?: { totals?: { subtotal?: number; tax?: number; shipping?: number; total?: number; currency?: string } } }
    | undefined;
  const checkoutCartData = useSelector("checkoutCartData") as
    | {
        subtotal?: number;
        formattedSubtotal?: string;
        tax?: number;
        formattedTax?: string;
        shipping?: number;
        formattedShipping?: string;
        total?: number;
        formattedTotal?: string;
        currencyCode?: string;
        itemCount?: number;
        hasPromo?: boolean;
        promoDiscount?: number;
        formattedPromoDiscount?: string | null;
      }
    | undefined;

  const inEditor = !!usePlasmicCanvasContext();

  const composableSummary = checkoutData?.summary;
  const sessionTotals = checkoutSessionCtx?.session?.totals;

  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !composableSummary && !sessionTotals && !checkoutCartData && inEditor);

  const totalsData = useMemo<OrderTotalsData>(() => {
    if (useMock) {
      log.debug("Using mock order totals for design-time preview");
      return MOCK_ORDER_TOTALS_DATA;
    }

    // Source 1: checkoutData.summary (from EPCheckoutProvider)
    if (composableSummary) {
      log.debug("Using checkoutData.summary from EPCheckoutProvider");
      return composableSummary;
    }

    // Source 2: checkoutSession.totals (from EPCheckoutSessionProvider)
    if (sessionTotals) {
      const cur = (sessionTotals.currency ?? "USD").toUpperCase();
      const fmt = (cents: number) => {
        try {
          return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: cur,
          }).format(cents / 100);
        } catch {
          return `$${(cents / 100).toFixed(2)}`;
        }
      };
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

    // Source 3: checkoutCartData (from EPCheckoutCartSummary)
    if (checkoutCartData) {
      const discount = checkoutCartData.promoDiscount ?? 0;
      return {
        subtotal: checkoutCartData.subtotal ?? 0,
        subtotalFormatted: checkoutCartData.formattedSubtotal ?? "$0.00",
        tax: checkoutCartData.tax ?? 0,
        taxFormatted: checkoutCartData.formattedTax ?? "$0.00",
        shipping: checkoutCartData.shipping ?? 0,
        shippingFormatted: checkoutCartData.formattedShipping ?? "TBD",
        discount,
        discountFormatted: checkoutCartData.formattedPromoDiscount ?? "$0.00",
        hasDiscount: discount > 0,
        total: checkoutCartData.total ?? 0,
        totalFormatted: checkoutCartData.formattedTotal ?? "$0.00",
        currency: checkoutCartData.currencyCode ?? "USD",
        itemCount: checkoutCartData.itemCount ?? 0,
      };
    }

    // Fallback — outside providers, non-production warning
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      log.warn("EPOrderTotalsBreakdown used outside both EPCheckoutSessionProvider and EPCheckoutCartSummary — using mock data");
    }
    return MOCK_ORDER_TOTALS_DATA;
  }, [useMock, composableSummary, sessionTotals, checkoutCartData]);

  return (
    <DataProvider name="orderTotalsData" data={totalsData}>
      <div className={className} data-ep-order-totals-breakdown="">
        {children}
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
        defaultValue: [
          {
            type: "vbox",
            children: [
              {
                type: "hbox",
                children: [
                  { type: "text", value: "Subtotal" },
                  { type: "text", value: "$0.00" },
                ],
              },
              {
                type: "hbox",
                children: [
                  { type: "text", value: "Shipping" },
                  { type: "text", value: "$0.00" },
                ],
              },
              {
                type: "hbox",
                children: [
                  { type: "text", value: "Tax" },
                  { type: "text", value: "$0.00" },
                ],
              },
              {
                type: "hbox",
                children: [
                  { type: "text", value: "Total" },
                  { type: "text", value: "$0.00" },
                ],
              },
            ],
          },
        ],
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
