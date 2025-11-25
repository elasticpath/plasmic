import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { useFormContext } from "react-hook-form";
import { CommerceError, Product } from "@plasmicpkgs/commerce";
import useAddItem from "./cart/use-add-item";
import { useProductStock } from "./inventory/use-stock";
import { Registerable } from "./registerable";
import {
  extractCartItemFromForm,
  validateAndParseQuantity,
  resolveLocationSlug,
  toCartItemBody,
} from "./cart/utils/cartDataBuilder";
import {
  validateStockAvailability,
  getStockStatusInfo,
  shouldPerformStockCheck,
} from "./inventory/utils/stockValidation";
import { getAvailableStockForLocation } from "./inventory/utils/stockCalculations";
import { createFormContextError, formatUserErrorMessage } from "./utils/errorHandling";

interface EPAddToCartButtonProps {
  children?: React.ReactNode;
  enableStockCheck?: boolean;
  locationId?: string;
  locationSlug?: string;
  showStockStatus?: boolean;
}

export const epAddToCartButtonMeta: ComponentMeta<EPAddToCartButtonProps> = {
  name: "plasmic-commerce-ep-add-to-cart-button",
  displayName: "EP Add To Cart Button",
  description: "Elastic Path specific add to cart button with bundle and stock support",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "button",
          value: "Add To Cart",
        },
      ],
    },
    enableStockCheck: {
      type: "boolean",
      displayName: "Enable Stock Check",
      description: "Check product stock before allowing add to cart",
      defaultValue: false,
    },
    locationId: {
      type: "string",
      displayName: "Location ID",
      description: "Specific location ID to check stock for (optional)",
    },
    locationSlug: {
      type: "string",
      displayName: "Location Slug",
      description: "Specific location slug to check stock for (optional)",
    },
    showStockStatus: {
      type: "boolean",
      displayName: "Show Stock Status",
      description: "Display stock information with the button",
      defaultValue: false,
    },
  },
  importPath: "@plasmicpkgs/commerce",
  importName: "EPAddToCartButton",
};

export function EPAddToCartButton(props: EPAddToCartButtonProps) {
  const { children, enableStockCheck = false, locationId, locationSlug, showStockStatus = false } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext();
  const addItem = useAddItem();

  // Hook for stock checking when enabled
  const { stock, loading: stockLoading } = useProductStock(
    product?.id || "",
    undefined, // Don't filter by location in stock hook - we'll filter when needed
    enableStockCheck && !!product?.id // Simple condition to avoid circular dependency
  );

  // Helper to get current target location slug
  const getTargetLocationSlug = () => {
    const formValues = form?.getValues();
    return resolveLocationSlug(
      formValues || {},
      { locationSlug, locationId }
    );
  };

  const getAvailableStock = (): number => {
    if (!enableStockCheck || !stock) return Infinity;
    
    const targetLocationSlug = getTargetLocationSlug();
    return getAvailableStockForLocation(stock, targetLocationSlug);
  };

  const addToCart = async () => {
    if (!form) {
      const error = createFormContextError("EPAddToCartButton");
      throw new CommerceError({ message: formatUserErrorMessage(error) });
    }

    // Validate quantity
    const quantityValidation = validateAndParseQuantity(form.getValues()["ProductQuantity"] ?? 1);
    if (!quantityValidation.isValid) {
      throw new CommerceError({ message: quantityValidation.errorMessage || "Invalid quantity" });
    }

    // Stock validation when enabled
    if (shouldPerformStockCheck(product?.id || "", stock, enableStockCheck)) {
      const targetLocationSlug = getTargetLocationSlug();
      const stockValidation = validateStockAvailability(
        stock!,
        quantityValidation.quantity,
        targetLocationSlug
      );

      if (!stockValidation.isValid) {
        throw new CommerceError({ message: stockValidation.errorMessage || "Insufficient stock" });
      }
    }

    if (product) {
      const cartItem = extractCartItemFromForm(
        form.getValues(),
        product,
        { locationSlug, locationId }
      );
      await addItem(cartItem);
    }
  };

  const availableStock = getAvailableStock();
  const isOutOfStock = enableStockCheck && availableStock <= 0;
  const isDisabled = isOutOfStock || stockLoading;

  // If showing stock status, wrap in container
  if (showStockStatus && enableStockCheck) {
    const stockStatusInfo = getStockStatusInfo(availableStock);
    
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* Stock Status Display */}
        <div style={{ fontSize: "0.875rem" }}>
          {stockLoading ? (
            <span style={{ color: "#666" }}>Checking stock...</span>
          ) : (
            <span 
              style={{ 
                color: stockStatusInfo.status === 'out-of-stock' ? "#d32f2f" :
                       stockStatusInfo.status === 'low' ? "#f57c00" : "#388e3c",
                fontWeight: "500"
              }}
            >
              {stockStatusInfo.message}
            </span>
          )}
        </div>
        
        {/* Button */}
        {React.isValidElement(children) ? (
          React.cloneElement(children, {
            disabled: isDisabled,
            onClick: (e: MouseEvent) => {
              if (children.props.onClick && typeof children.props.onClick === "function") {
                children.props.onClick(e);
              }
              if (!isDisabled) {
                addToCart();
              }
            },
            style: {
              ...children.props.style,
              opacity: isDisabled ? 0.6 : 1,
              cursor: isDisabled ? "not-allowed" : "pointer",
            },
          } as Partial<unknown> & React.Attributes)
        ) : (
          <button
            onClick={addToCart}
            disabled={isDisabled}
            style={{
              padding: "12px 24px",
              backgroundColor: isDisabled ? "#ccc" : "#007bff",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "1rem",
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            {isOutOfStock ? "Out of Stock" : "Add to Cart"}
          </button>
        )}
      </div>
    );
  }

  // Standard button behavior
  return React.isValidElement(children)
    ? React.cloneElement(children, {
        disabled: isDisabled,
        onClick: (e: MouseEvent) => {
          if (
            children.props.onClick &&
            typeof children.props.onClick === "function"
          ) {
            children.props.onClick(e);
          }
          if (!isDisabled) {
            addToCart();
          }
        },
        style: {
          ...children.props.style,
          opacity: isDisabled ? 0.6 : 1,
          cursor: isDisabled ? "not-allowed" : "pointer",
        },
      } as Partial<unknown> & React.Attributes)
    : null;
}

export function registerEPAddToCartButton(
  loader?: Registerable,
  customEPAddToCartButtonMeta?: ComponentMeta<EPAddToCartButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAddToCartButton,
    customEPAddToCartButtonMeta ?? epAddToCartButtonMeta
  );
}