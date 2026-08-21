/**
 * EPShippingMethodSelector — repeater for available shipping methods.
 *
 * Reads `shippingAddressFieldsData` to determine when to fetch rates,
 * then repeats children once per shipping rate. Exposes `currentShippingMethod`
 * and `currentShippingMethodIndex` per iteration.
 *
 * refActions: selectMethod
 */
import {
  DataProvider,
  repeatedElement,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Registerable } from "../../registerable";
import { MOCK_SHIPPING_RATES } from "../../utils/design-time-data";
import { createLogger } from "../../utils/logger";
import { useMoneyFormat } from "../../shopper-context/use-money-format";

const log = createLogger("EPShippingMethodSelector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PreviewState = "auto" | "withRates" | "loading" | "empty";

interface ShippingMethod {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  estimatedDays: string;
  carrier: string;
  isSelected: boolean;
}

interface EPShippingMethodSelectorActions {
  selectMethod(rateId: string): void;
}

interface EPShippingMethodSelectorProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const EPShippingMethodSelector = React.forwardRef<
  EPShippingMethodSelectorActions,
  EPShippingMethodSelectorProps
>(function EPShippingMethodSelector(props, ref) {
  const {
    children,
    loadingContent,
    emptyContent,
    className,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  // Read composable checkout context (EPCheckoutProvider flow)
  const checkoutData = useSelector("checkoutData") as
    | { step?: string; selectedShippingRate?: { id: string } | null }
    | undefined;

  // Read checkout session context (session-based flow)
  const checkoutSessionCtx = useSelector("checkoutSession") as
    | {
        session?: {
          availableShippingRates?: Array<{
            id: string;
            name: string;
            amount: number;
            currency: string;
            deliveryTime?: string;
            carrier?: string;
            serviceLevel?: string;
          }>;
          selectedShippingRateId?: string | null;
        };
        isLoading?: boolean;
        updateSession?: (data: Record<string, unknown>) => Promise<void>;
      }
    | undefined;

  // Read shipping address to trigger rate fetch (composable/legacy flow)
  const shippingAddress = useSelector("shippingAddressFieldsData") as
    | {
        isValid?: boolean;
        firstName?: string;
        lastName?: string;
        line1?: string;
        city?: string;
        postcode?: string;
        country?: string;
      }
    | undefined;

  const hasSessionRates = !!(checkoutSessionCtx?.session?.availableShippingRates?.length);

  // Design-time preview
  if (previewState !== "auto" || (inEditor && !checkoutSessionCtx && !checkoutData && !shippingAddress)) {
    const effectivePreview = previewState === "auto" ? "withRates" : previewState;

    if (effectivePreview === "loading") {
      return (
        <div className={className} data-ep-shipping-method-selector="">
          {loadingContent ?? <div>Loading shipping rates...</div>}
        </div>
      );
    }

    if (effectivePreview === "empty") {
      return (
        <div className={className} data-ep-shipping-method-selector="">
          {emptyContent ?? <div>No shipping methods available</div>}
        </div>
      );
    }

    // withRates — render mock rates
    const mockSelectMethod = () => {
      log.debug("selectMethod is a no-op in design-time preview");
    };

    if (ref && typeof ref === "object") {
      (ref as React.MutableRefObject<EPShippingMethodSelectorActions>).current = {
        selectMethod: mockSelectMethod,
      };
    }

    return (
      <div className={className} data-ep-shipping-method-selector="">
        {(MOCK_SHIPPING_RATES as ShippingMethod[]).map((rate, i) => (
          <DataProvider key={rate.id} name="currentShippingMethod" data={rate}>
            <DataProvider name="currentShippingMethodIndex" data={i}>
              {children ?? (
                <DefaultRateRow
                  name={rate.name}
                  priceFormatted={rate.priceFormatted}
                  estimatedDays={rate.estimatedDays}
                  isSelected={rate.isSelected}
                />
              )}
            </DataProvider>
          </DataProvider>
        ))}
      </div>
    );
  }

  return (
    <EPShippingMethodSelectorRuntime
      ref={ref}
      className={className}
      checkoutSessionCtx={checkoutSessionCtx}
      shippingAddress={shippingAddress}
      loadingContent={loadingContent}
      emptyContent={emptyContent}
    >
      {children}
    </EPShippingMethodSelectorRuntime>
  );
});

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------
interface RuntimeProps {
  children?: React.ReactNode;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  className?: string;
  checkoutSessionCtx?: {
    session?: {
      availableShippingRates?: Array<{
        id: string;
        name: string;
        amount: number;
        currency: string;
        deliveryTime?: string;
        carrier?: string;
        serviceLevel?: string;
      }>;
      selectedShippingRateId?: string | null;
    };
    isLoading?: boolean;
    updateSession?: (data: Record<string, unknown>) => Promise<void>;
  };
  shippingAddress?: {
    isValid?: boolean;
    firstName?: string;
    lastName?: string;
    line1?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
}


/**
 * The row a rate renders when the slot is empty.
 *
 * The default used to be the literal text "Shipping Method" and "$0.00", and the
 * live repeater rendered nothing at all without slot content — so the shipping
 * step was either fake or blank. Selecting is a ref action the designer wires,
 * so the default row does it itself: otherwise the shopper can read the rates
 * and not choose one.
 */
function DefaultRateRow(props: {
  name: string;
  priceFormatted: string;
  estimatedDays?: string;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const { name, priceFormatted, estimatedDays, isSelected, onSelect } = props;
  return (
    <div
      data-ep-rate-row=""
      data-selected={isSelected || undefined}
      role="radio"
      aria-checked={!!isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
    >
      <span data-ep-rate-name="">{name}</span>
      {estimatedDays ? (
        <span data-ep-rate-eta="">{estimatedDays}</span>
      ) : null}
      <span data-ep-rate-price="">{priceFormatted}</span>
    </div>
  );
}

const EPShippingMethodSelectorRuntime = React.forwardRef<
  EPShippingMethodSelectorActions,
  RuntimeProps
>(function EPShippingMethodSelectorRuntime(props, ref) {
  const money = useMoneyFormat();
  const {
    children,
    loadingContent,
    emptyContent,
    className,
    checkoutSessionCtx,
    shippingAddress,
  } = props;

  const sessionRates = checkoutSessionCtx?.session?.availableShippingRates;
  const useSessionMode = !!(sessionRates && sessionRates.length > 0);

  // Nothing is fetched here any more (see below): rates arrive with the
  // session, so its loading state is ours.
  const isLoading = !!checkoutSessionCtx?.isLoading;
  const [selectedId, setSelectedId] = useState<string | null>(
    checkoutSessionCtx?.session?.selectedShippingRateId ?? null
  );

  // Session mode: derive rates from checkoutSession.availableShippingRates
  const sessionDerivedRates = useMemo<ShippingMethod[]>(() => {
    if (!sessionRates) return [];
    const cur = (sessionRates[0]?.currency ?? "USD").toUpperCase();
    const fmt = (minor: number) => money.minor(minor, cur);
    return sessionRates.map((r) => ({
      id: r.id,
      name: r.name,
      price: r.amount,
      priceFormatted: fmt(r.amount),
      estimatedDays: r.deliveryTime ?? "",
      carrier: r.carrier ?? "",
      isSelected: false,
    }));
  }, [sessionRates, money]);

  // Rates come from the checkout session, which sources them server-side via
  // `ctx.shippingRateResolver` (#371/#374). There is no shopper-facing shipping
  // rates endpoint in Elastic Path: this component used to POST to
  // /api/checkout/calculate-shipping, a route the package deliberately retired
  // and answers with 410 Gone, so the request could only ever fail and the
  // shipping step sat empty with no explanation.
  const needsSession = !useSessionMode && !!shippingAddress?.isValid;
  useEffect(() => {
    if (!needsSession) return;
    log.warn(
      "Shipping rates require an EP Checkout Session Provider — rates are resolved server-side and are not fetchable from the browser"
    );
  }, [needsSession]);

  // Sync selectedId from session
  useEffect(() => {
    if (useSessionMode && checkoutSessionCtx?.session?.selectedShippingRateId) {
      setSelectedId(checkoutSessionCtx.session.selectedShippingRateId);
    }
  }, [useSessionMode, checkoutSessionCtx?.session?.selectedShippingRateId]);

  const selectMethod = useCallback((rateId: string) => {
    setSelectedId(rateId);
    // In session mode, also update the server session
    if (checkoutSessionCtx?.updateSession) {
      checkoutSessionCtx.updateSession({ selectedShippingRateId: rateId }).catch((err) => {
        log.warn("Failed to update session with selected shipping rate:", err);
      });
    }
  }, [checkoutSessionCtx]);

  useImperativeHandle(ref, () => ({ selectMethod }), [selectMethod]);

  // Choose rate source: session or fetched
  const rates = useSessionMode ? sessionDerivedRates : [];

  // Apply selection state to rates
  const ratesWithSelection = useMemo(
    () =>
      rates.map((r) => ({
        ...r,
        isSelected: r.id === selectedId,
      })),
    [rates, selectedId]
  );

  if (isLoading) {
    return (
      <div className={className} data-ep-shipping-method-selector="">
        {loadingContent ?? <div>Loading shipping rates...</div>}
      </div>
    );
  }

  if (ratesWithSelection.length === 0) {
    return (
      <div className={className} data-ep-shipping-method-selector="">
        {emptyContent ?? <div>No shipping methods available</div>}
      </div>
    );
  }

  return (
    <div
      className={className}
      data-ep-shipping-method-selector=""
      // Only the default rows are radios; a filled slot is the designer's own
      // markup and must not be described as a radio group.
      role={children ? undefined : "radiogroup"}
      aria-label={children ? undefined : "Shipping methods"}
    >
      {ratesWithSelection.map((rate, i) => (
        <DataProvider key={rate.id} name="currentShippingMethod" data={rate}>
          <DataProvider name="currentShippingMethodIndex" data={i}>
            {children ? (
              repeatedElement(i, children)
            ) : (
              <DefaultRateRow
                name={rate.name}
                priceFormatted={rate.priceFormatted}
                estimatedDays={rate.estimatedDays}
                isSelected={rate.isSelected}
                onSelect={() => selectMethod(rate.id)}
              />
            )}
          </DataProvider>
        </DataProvider>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epShippingMethodSelectorMeta: CodeComponentMeta<EPShippingMethodSelectorProps> =
  {
    name: "plasmic-commerce-ep-shipping-method-selector",
    displayName: "EP Shipping Method Selector",
    description:
      "Repeater that fetches and displays available shipping methods. Each iteration exposes currentShippingMethod data for binding.",
    props: {
      children: {
        type: "slot",
        description:
          "Optional. Leave empty for a selectable default row per rate; fill it to compose your own against currentShippingMethod.",
        hidePlaceholder: true,
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
    importName: "EPShippingMethodSelector",
    parentComponentName: "plasmic-commerce-ep-checkout-provider",
    providesData: true,
    refActions: {
      selectMethod: {
        displayName: "Select Method",
        argTypes: [
          { name: "rateId", type: "string", displayName: "Rate ID" },
        ],
      },
    },
  };

export function registerEPShippingMethodSelector(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPShippingMethodSelectorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPShippingMethodSelector,
    customMeta ?? epShippingMethodSelectorMeta
  );
}
