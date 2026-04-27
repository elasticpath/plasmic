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
import type { Product } from "@plasmicpkgs/commerce";
import useAddItem from "./cart/use-add-item";
import { Registerable } from "./registerable";
import { createLogger } from "./utils/logger";
import {
  extractCartItemFromForm,
  validateAndParseQuantity,
} from "./cart/utils/cartDataBuilder";

const log = createLogger("EPAddToCartButton");

type PreviewState = "auto" | "enabled" | "loading" | "error";

interface EPAddToCartButtonProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
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
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPAddToCartButton",
  providesData: true,
};

export function EPAddToCartButton(props: EPAddToCartButtonProps) {
  const { children, className, previewState = "auto" } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext();
  const addItem = useAddItem();
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
      log.debug("Form values", formValues as Record<string, unknown>);

      const quantityValidation = validateAndParseQuantity(
        formValues["ProductQuantity"] ?? 1
      );
      if (!quantityValidation.isValid) {
        setError(quantityValidation.errorMessage || "Invalid quantity");
        return;
      }

      const cartItem = extractCartItemFromForm(formValues, product, {});
      log.debug("Cart item", { ...cartItem } as Record<string, unknown>);

      await addItem(cartItem);
      log.info("Item added to cart successfully");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add item to cart";
      log.error("Add to cart failed", { error: message } as Record<string, unknown>);
      setError(message);
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
