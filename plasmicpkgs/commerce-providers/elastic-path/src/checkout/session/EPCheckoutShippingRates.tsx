import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useImperativeHandle } from "react";
import { Registerable } from "../../registerable";
import { MOCK_SESSION_COLLECTING } from "./design-time-data";
import type { SessionShippingRate } from "./types";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPCheckoutShippingRates");

type PreviewState = "auto" | "withRates" | "loading" | "empty";

interface CheckoutShippingRateView extends SessionShippingRate {
  isSelected: boolean;
}

interface EPCheckoutShippingRatesActions {
  selectRate(rateId: string): void;
}

interface EPCheckoutShippingRatesProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

interface CheckoutSessionCtx {
  session?: {
    availableShippingRates?: SessionShippingRate[];
    selectedShippingRateId?: string | null;
  } | null;
  isLoading?: boolean;
  updateSession?: (data: Record<string, unknown>) => Promise<unknown>;
}

function toRateViews(
  rates: SessionShippingRate[],
  selectedId: string | null | undefined
): CheckoutShippingRateView[] {
  return rates.map((rate) => ({
    ...rate,
    isSelected: rate.id === selectedId,
  }));
}

function RatesList(props: {
  rates: CheckoutShippingRateView[];
  children?: React.ReactNode;
  className?: string;
}) {
  const { rates, children, className } = props;
  return (
    <div className={className} data-ep-checkout-shipping-rates="">
      {rates.map((rate, i) =>
        children ? (
          <DataProvider key={rate.id} name="currentCheckoutShippingRate" data={rate}>
            <DataProvider name="currentCheckoutShippingRateIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        ) : null
      )}
    </div>
  );
}

export const EPCheckoutShippingRates = React.forwardRef<
  EPCheckoutShippingRatesActions,
  EPCheckoutShippingRatesProps
>(function EPCheckoutShippingRates(props, ref) {
  const {
    children,
    loadingContent,
    emptyContent,
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | CheckoutSessionCtx
    | undefined;

  const selectRate = useCallback(
    (rateId: string) => {
      if (inEditor && previewState !== "auto") {
        log.debug("selectRate is a no-op in design-time preview");
        return;
      }
      const updateSession = checkoutSessionCtx?.updateSession;
      if (!updateSession) {
        log.warn("selectRate called with no checkoutSession.updateSession");
        return;
      }
      updateSession({ selectedShippingRateId: rateId }).catch((err) => {
        log.warn("Failed to select shipping rate", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
    [checkoutSessionCtx?.updateSession, inEditor, previewState]
  );

  useImperativeHandle(ref, () => ({ selectRate }), [selectRate]);

  const usePreview =
    previewState !== "auto" || (inEditor && !checkoutSessionCtx);

  if (usePreview) {
    const effectivePreview = previewState === "auto" ? "withRates" : previewState;

    if (effectivePreview === "loading") {
      return (
        <div className={className} data-ep-checkout-shipping-rates="">
          {loadingContent ?? <div>Loading shipping rates...</div>}
        </div>
      );
    }

    if (effectivePreview === "empty") {
      return (
        <div className={className} data-ep-checkout-shipping-rates="">
          {emptyContent ?? <div>No shipping rates available</div>}
        </div>
      );
    }

    const mockRates = toRateViews(
      MOCK_SESSION_COLLECTING.availableShippingRates,
      MOCK_SESSION_COLLECTING.selectedShippingRateId
    );
    return (
      <RatesList rates={mockRates} className={className}>
        {children}
      </RatesList>
    );
  }

  if (checkoutSessionCtx?.isLoading && !(checkoutSessionCtx.session?.availableShippingRates?.length)) {
    return (
      <div className={className} data-ep-checkout-shipping-rates="">
        {loadingContent ?? <div>Loading shipping rates...</div>}
      </div>
    );
  }

  const rates = toRateViews(
    checkoutSessionCtx?.session?.availableShippingRates ?? [],
    checkoutSessionCtx?.session?.selectedShippingRateId
  );

  if (rates.length === 0) {
    return (
      <div className={className} data-ep-checkout-shipping-rates="">
        {emptyContent ?? <div>No shipping rates available</div>}
      </div>
    );
  }

  return (
    <RatesList rates={rates} className={className}>
      {children}
    </RatesList>
  );
});

export const epCheckoutShippingRatesMeta: CodeComponentMeta<EPCheckoutShippingRatesProps> =
  {
    name: "plasmic-commerce-ep-checkout-shipping-rates",
    displayName: "EP Checkout Shipping Rates",
    description:
      "Repeats children for each server-quoted shipping rate on the checkout session. Selecting a rate sends only its id — never an amount. Must be inside an EP Checkout Form Provider (under EP Checkout Session Provider).",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              { type: "text", value: "Shipping rate" },
              { type: "text", value: "$0.00" },
            ],
          },
        ],
      },
      loadingContent: {
        type: "slot",
        displayName: "Loading Content",
        hidePlaceholder: true,
      },
      emptyContent: {
        type: "slot",
        displayName: "Empty Content",
        hidePlaceholder: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withRates", "loading", "empty"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutShippingRates",
    parentComponentName: "plasmic-commerce-ep-checkout-form-provider",
    providesData: true,
    refActions: {
      selectRate: {
        displayName: "Select Rate",
        argTypes: [{ name: "rateId", type: "string", displayName: "Rate ID" }],
      },
    },
  };

export function registerEPCheckoutShippingRates(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutShippingRatesProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutShippingRates,
    customMeta ?? epCheckoutShippingRatesMeta
  );
}
