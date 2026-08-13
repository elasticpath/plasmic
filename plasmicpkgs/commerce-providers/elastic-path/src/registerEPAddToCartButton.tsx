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
import type { Product } from "@plasmicpkgs/commerce";
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
  const { children, className, previewState = "auto", onAddedToCart } = props;

  const product = useSelector("currentProduct") as Product | undefined;
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
  const effectiveIsDisabled = useMock
    ? false
    : (previewState === "auto" && inEditor && !product)
      ? false
      : (!product || isLoading);

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

      const cartItem = extractCartItemFromForm(formValues, product, {});
      const customInputs = cartItem.selectedOptions?.length
        ? { _selectedOptions: cartItem.selectedOptions }
        : undefined;

      await callEpProxy("addCartItem", {
        productId: cartItem.variantId || cartItem.productId || product.id,
        quantity: cartItem.quantity ?? 1,
        ...(customInputs ? { customInputs } : {}),
        ...(cartItem.bundleConfiguration
          ? { bundleConfiguration: cartItem.bundleConfiguration }
          : {}),
        ...(cartItem.locationId ? { location: cartItem.locationId } : {}),
      });

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
