import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { mutate as swrMutate } from "swr";
import type { Product } from "./types/product";
import { Registerable } from "./registerable";
import { createLogger } from "./utils/logger";
import {
  extractCartItemFromForm,
  validateAndParseQuantity,
} from "./cart/utils/cartDataBuilder";
import {
  callEpProxy,
  epProxyErrorCode,
} from "./ep-server-functions/proxy-fetch";
import { cartMutationErrorCopy } from "./ep-server-functions/cart-mutation-error-copy";
import { epCartCacheKey } from "./cart-provider/cache-keys";

const log = createLogger("EPAddToCartButton");

const GENERIC_ADD_TO_CART_ERROR =
  "We couldn't add this item to your cart. Please try again.";

type PreviewState = "auto" | "enabled" | "loading" | "error";

interface EPAddToCartButtonProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
  /** Fired after the item is successfully added to the cart. */
  onAddedToCart?: () => void;
  /**
   * Render the failure reason inside the button when an add fails and nothing
   * in the slot is bound to `addToCartState.error`. On by default: a silently
   * swallowed rejection leaves the shopper with no idea why nothing happened.
   */
  showError?: boolean;
  /** @deprecated Inert. Use EPStockProvider / EPStockField. */
  enableStockCheck?: boolean;
  /** @deprecated Inert. Use EPLocationPicker. */
  locationId?: string;
  /** @deprecated Inert. Use EPLocationPicker. */
  locationSlug?: string;
  /** @deprecated Inert. Use EPStockField. */
  showStockStatus?: boolean;
}

export const epAddToCartButtonMeta: CodeComponentMeta<EPAddToCartButtonProps> = {
  name: "plasmic-commerce-ep-add-to-cart-button",
  displayName: "EP Add To Cart Button",
  description:
    "Adds the current product to the cart when clicked. Reads variant, quantity, bundle configuration, and location from form context. Must be placed inside a Product Box.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "text",
          value: "Add To Cart",
        },
      ],
    },
    previewState: {
      type: "choice",
      options: ["auto", "enabled", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
    showError: {
      type: "boolean",
      displayName: "Show Error",
      description:
        "Render the failure reason inside the button when an add fails. Turn off if you bind addToCartState.error yourself.",
      defaultValue: true,
    },
    onAddedToCart: {
      type: "eventHandler" as const,
      displayName: "On Added To Cart",
      description:
        "Fires after the item is successfully added to the cart. Wire to open a confirmation modal, toast, or drawer.",
      argTypes: [],
    },
    // Inert. Hostless publishing rejects removing a published prop.
    enableStockCheck: {
      type: "boolean",
      hidden: () => true,
      description:
        "Deprecated and ignored. Use EP Stock Provider / EP Stock Field.",
    },
    locationId: {
      type: "string",
      hidden: () => true,
      description: "Deprecated and ignored. Use EP Location Picker.",
    },
    locationSlug: {
      type: "string",
      hidden: () => true,
      description: "Deprecated and ignored. Use EP Location Picker.",
    },
    showStockStatus: {
      type: "boolean",
      hidden: () => true,
      description: "Deprecated and ignored. Use EP Stock Field.",
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPAddToCartButton",
  providesData: true,
};

export function EPAddToCartButton(props: EPAddToCartButtonProps) {
  const {
    children,
    className,
    previewState = "auto",
    onAddedToCart,
    showError = true,
  } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  // An invalid bundle configuration is rejected by Elastic Path, so the button
  // must not offer the add in the first place.
  const bundleData = useSelector("bundleData") as
    | { isValid?: boolean; errors?: string[] }
    | undefined;
  const form = useFormContext();
  const inEditor = !!usePlasmicCanvasContext();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMock = previewState !== "auto";
  const effectiveIsLoading = useMock
    ? previewState === "loading"
    : isLoading;
  const effectiveError = useMock
    ? previewState === "error" ? "Sample error message" : null
    : error;
  const isBundleInvalid = bundleData ? bundleData.isValid === false : false;
  const effectiveIsDisabled = useMock
    ? false
    : (previewState === "auto" && inEditor && !product)
      ? false
      : (!product || isLoading || isBundleInvalid);

  const addToCart = async () => {
    if (!product) {
      log.warn("Add to cart aborted: no product in context");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const formValues = form ? form.getValues() : {};
      const quantityValidation = validateAndParseQuantity(
        formValues["ProductQuantity"] ?? 1
      );
      if (!quantityValidation.isValid) {
        setError(quantityValidation.errorMessage || "Invalid quantity");
        return;
      }

      await callEpProxy(
        "addCartItem",
        extractCartItemFromForm(formValues, product, {}) as unknown as Record<
          string,
          unknown
        >
      );

      // Refresh any EPCartProvider in the tree.
      await swrMutate(epCartCacheKey());

      log.info("Item added to cart successfully");

      // Notify consumers (e.g. open a confirmation modal). Fired only on a
      // successful add — never when the add is aborted (no product / invalid
      // quantity) or errors.
      onAddedToCart?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add item to cart";
      log.error("Add to cart failed", {
        error: message,
        code: epProxyErrorCode(err),
      } as Record<string, unknown>);
      setError(cartMutationErrorCopy(err, GENERIC_ADD_TO_CART_ERROR));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DataProvider
      name="addToCartState"
      data={{
        isLoading: effectiveIsLoading,
        isDisabled: effectiveIsDisabled,
        error: effectiveError,
      }}
    >
      <div
        className={className}
        onClick={() => {
          if (!effectiveIsDisabled && !useMock) {
            addToCart();
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (
            (e.key === "Enter" || e.key === " ") &&
            !effectiveIsDisabled &&
            !useMock
          ) {
            e.preventDefault();
            addToCart();
          }
        }}
        aria-disabled={effectiveIsDisabled}
        data-loading={effectiveIsLoading || undefined}
      >
        {children}
        {showError && effectiveError ? (
          <span data-ep-add-to-cart-error="" role="alert">
            {effectiveError}
          </span>
        ) : null}
      </div>
    </DataProvider>
  );
}

export function registerEPAddToCartButton(
  loader?: Registerable,
  customEPAddToCartButtonMeta?: CodeComponentMeta<EPAddToCartButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAddToCartButton,
    customEPAddToCartButtonMeta ?? epAddToCartButtonMeta
  );
}
