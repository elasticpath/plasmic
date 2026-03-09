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
  ComponentMeta,
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

  // Read checkout context for shipping rate selection
  const checkoutData = useSelector("checkoutData") as
    | { selectedShippingRate?: { id?: string } }
    | undefined;

  // Read shipping address to trigger rate fetch
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

  // Design-time preview
  if (previewState !== "auto" || (inEditor && !checkoutData)) {
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
        {(MOCK_SHIPPING_RATES as ShippingMethod[]).map((rate, i) =>
          children ? (
            <DataProvider key={rate.id} name="currentShippingMethod" data={rate}>
              <DataProvider name="currentShippingMethodIndex" data={i}>
                {repeatedElement(i, children)}
              </DataProvider>
            </DataProvider>
          ) : null
        )}
      </div>
    );
  }

  return (
    <EPShippingMethodSelectorRuntime
      ref={ref}
      className={className}
      checkoutData={checkoutData}
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
  checkoutData?: { selectedShippingRate?: { id?: string } };
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

const EPShippingMethodSelectorRuntime = React.forwardRef<
  EPShippingMethodSelectorActions,
  RuntimeProps
>(function EPShippingMethodSelectorRuntime(props, ref) {
  const {
    children,
    loadingContent,
    emptyContent,
    className,
    checkoutData,
    shippingAddress,
  } = props;

  const [rates, setRates] = useState<ShippingMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    checkoutData?.selectedShippingRate?.id ?? null
  );

  // Fetch shipping rates when address is valid
  useEffect(() => {
    if (!shippingAddress?.isValid) return;

    let cancelled = false;
    setIsLoading(true);

    // Use fetch directly — the API route handles cart identity from cookie
    fetch("/api/checkout/calculate-shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        shippingAddress: {
          first_name: shippingAddress.firstName ?? "",
          last_name: shippingAddress.lastName ?? "",
          line_1: shippingAddress.line1 ?? "",
          city: shippingAddress.city ?? "",
          postcode: shippingAddress.postcode ?? "",
          country: shippingAddress.country ?? "",
        },
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const fetchedRates: ShippingMethod[] = (
          data?.data?.shippingRates ?? []
        ).map((r: any) => ({
          id: r.id ?? r.name,
          name: r.name ?? "Shipping",
          price: r.amount ?? r.price ?? 0,
          priceFormatted: r.priceFormatted ?? r.formatted_amount ?? "$0.00",
          estimatedDays: r.estimatedDays ?? r.estimated_days ?? "",
          carrier: r.carrier ?? "",
          isSelected: false,
        }));
        setRates(fetchedRates);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn("Failed to fetch shipping rates:", err);
        setRates([]);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    shippingAddress?.isValid,
    shippingAddress?.line1,
    shippingAddress?.city,
    shippingAddress?.postcode,
    shippingAddress?.country,
  ]);

  const selectMethod = useCallback((rateId: string) => {
    setSelectedId(rateId);
  }, []);

  useImperativeHandle(ref, () => ({ selectMethod }), [selectMethod]);

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
    <div className={className} data-ep-shipping-method-selector="">
      {ratesWithSelection.map((rate, i) =>
        children ? (
          <DataProvider key={rate.id} name="currentShippingMethod" data={rate}>
            <DataProvider name="currentShippingMethodIndex" data={i}>
              {repeatedElement(i, children)}
            </DataProvider>
          </DataProvider>
        ) : null
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Registration metadata
// ---------------------------------------------------------------------------
export const epShippingMethodSelectorMeta: ComponentMeta<EPShippingMethodSelectorProps> =
  {
    name: "plasmic-commerce-ep-shipping-method-selector",
    displayName: "EP Shipping Method Selector",
    description:
      "Repeater that fetches and displays available shipping methods. Each iteration exposes currentShippingMethod data for binding.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "hbox",
            children: [
              { type: "text", value: "Shipping Method" },
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
    importName: "EPShippingMethodSelector",
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
  customMeta?: ComponentMeta<EPShippingMethodSelectorProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPShippingMethodSelector,
    customMeta ?? epShippingMethodSelectorMeta
  );
}
