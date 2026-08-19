import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo, useState } from "react";
import { Registerable } from "../../registerable";
import { useCheckoutCart } from "../../shopper-context/use-checkout-cart";
import type { Cart } from "../../types/cart";
import { createLogger } from "../../utils/logger";
import { MOCK_CHECKOUT_CART_DATA } from "../../utils/design-time-data";

const log = createLogger("EPCheckoutCartSummary");

type PreviewState = "auto" | "withItems" | "empty";

interface EPCheckoutCartSummaryProps {
  children?: React.ReactNode;
  className?: string;
  showImages?: boolean;
  collapsible?: boolean;
  isExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  previewState?: PreviewState;
  /**
   * Optional external cart data from useCheckoutCart(). When provided,
   * skips the internal cart fetch entirely. This is a code-only prop —
   * not exposed in Plasmic Studio meta.
   */
  cartData?: Cart;
}

export const epCheckoutCartSummaryMeta: CodeComponentMeta<EPCheckoutCartSummaryProps> =
  {
    name: "plasmic-commerce-ep-checkout-cart-summary",
    displayName: "EP Checkout Cart Summary",
    description:
      "Fetches live cart data and provides it to child components for the checkout order summary panel.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-checkout-cart-item-list",
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-checkout-cart-field",
            props: { field: "formattedSubtotal" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-checkout-cart-field",
            props: { field: "formattedTotal" },
          },
        ],
      },
      showImages: {
        type: "boolean",
        defaultValue: true,
        displayName: "Show Images",
      },
      collapsible: {
        type: "boolean",
        defaultValue: false,
        displayName: "Collapsible",
        description: "Allow collapsing the summary (useful on mobile)",
      },
      isExpanded: {
        type: "boolean",
        defaultValue: true,
        displayName: "Expanded",
        description: "Controls whether the summary is expanded",
        hidden: (props) => !props.collapsible,
      },
      onExpandedChange: {
        type: "eventHandler" as const,
        argTypes: [{ name: "expanded", type: "boolean" }],
      },
      previewState: {
        type: "choice",
        options: ["auto", "withItems", "empty"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCheckoutCartSummary",
    providesData: true,
  };

/**
 * When external cartData is provided (server-route mode via useCheckoutCart),
 * skip internal EP SDK hooks entirely — avoids requiring CommerceProvider.
 * Delegates to EPCheckoutCartSummaryInternal for the hooks-based path.
 */
export function EPCheckoutCartSummary(props: EPCheckoutCartSummaryProps) {
  const { cartData: externalCartData, children, className } = props;

  if (externalCartData) {
    return (
      <DataProvider name="cart" data={externalCartData}>
        <div className={className} data-ep-checkout-summary="">
          {children}
        </div>
      </DataProvider>
    );
  }

  return <EPCheckoutCartSummaryInternal {...props} />;
}

/** Internal implementation with hooks — only rendered when no external cartData. */
function EPCheckoutCartSummaryInternal(
  props: Omit<EPCheckoutCartSummaryProps, "cartData">
) {
  const {
    children,
    className,
    showImages = true,
    collapsible = false,
    isExpanded: isExpandedProp = true,
    onExpandedChange,
    previewState = "auto",
  } = props;

  const { data: cart } = useCheckoutCart();
  const inEditor = !!usePlasmicCanvasContext();

  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = isExpandedProp ?? internalExpanded;

  const toggleExpanded = () => {
    const next = !isExpanded;
    setInternalExpanded(next);
    onExpandedChange?.(next);
  };

  const cartData = useMemo(
    () => (cart ? { ...cart, showImages } : null),
    [cart, showImages]
  );

  const useMock =
    previewState === "withItems" ||
    (previewState === "auto" && !cart && inEditor);

  const effectiveData = useMock
    ? { ...MOCK_CHECKOUT_CART_DATA, showImages }
    : previewState === "empty"
      ? {
          ...MOCK_CHECKOUT_CART_DATA,
          items: [],
          itemCount: 0,
          subtotal: 0,
          total: 0,
          formattedSubtotal: "$0.00",
          formattedTotal: "$0.00",
          showImages,
        }
      : cartData;

  if (useMock) {
    log.debug("Using mock checkout cart data for design-time preview");
  }

  return (
    <DataProvider name="cart" data={effectiveData}>
      <div className={className} data-ep-checkout-summary="">
        {collapsible ? (
          <>
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={isExpanded}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                width: "100%",
                textAlign: "left",
              }}
            >
              Order Summary {isExpanded ? "▲" : "▼"}
            </button>
            {isExpanded && children}
          </>
        ) : (
          children
        )}
      </div>
    </DataProvider>
  );
}

export function registerEPCheckoutCartSummary(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCheckoutCartSummaryProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCheckoutCartSummary,
    customMeta ?? epCheckoutCartSummaryMeta
  );
}
