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
  // For stock checking, we'll get the location dynamically
  const { stock, loading: stockLoading } = useProductStock(
    product?.id || "",
    undefined, // Don't filter by location in stock hook - we'll filter in getAvailableStock
    enableStockCheck && !!product?.id
  );

  // Helper to get current target location slug
  const getTargetLocationSlug = () => {
    const formValues = form?.getValues();
    const formSelectedLocationSlug = formValues ? formValues["SelectedLocationSlug"] : undefined;
    return formSelectedLocationSlug || locationSlug || locationId;
  };

  const getAvailableStock = (): number => {
    if (!enableStockCheck || !stock) return Infinity;
    
    const targetLocationSlug = getTargetLocationSlug();
    if (targetLocationSlug) {
      const locationStock = stock.locations.find(ls => 
        ls.location.id === targetLocationSlug || 
        (ls.location as any).slug === targetLocationSlug
      );
      return Number(locationStock?.stock.available || 0);
    }
    
    return Number(stock.totalAvailable);
  };

  const addToCart = async () => {
    if (!form) {
      throw new Error("EPAddToCartButton must be used within a ProductProvider that provides a form context");
    }
    
    const quantity = +(form.getValues()["ProductQuantity"] ?? 1);
    if (isNaN(quantity) || quantity < 1) {
      throw new CommerceError({
        message: "The item quantity has to be a valid integer greater than 0",
      });
    }

    // Stock validation when enabled
    if (enableStockCheck) {
      const availableStock = getAvailableStock();
      if (availableStock < quantity) {
        throw new CommerceError({
          message: availableStock === 0 
            ? "This item is out of stock" 
            : `Only ${availableStock} items available`,
        });
      }
    }

    if (product) {
      const variantId = form.getValues()["ProductVariant"] ?? product.variants[0]?.id;
      const bundleConfiguration = form.getValues()["BundleConfiguration"];
      const targetLocationSlug = getTargetLocationSlug(); // Get fresh location slug
      
      // Debug logging
      console.log("Form values:", form.getValues());
      console.log("Target location slug:", targetLocationSlug);
      console.log("Props - locationId:", locationId, "locationSlug:", locationSlug);
      
      const addItemData = {
        productId: product.id,
        variantId: variantId,
        quantity: quantity,
        ...(bundleConfiguration && { bundleConfiguration }),
        ...(targetLocationSlug && { locationId: targetLocationSlug }),
      };
      
      console.log("Add item data:", addItemData);
      
      await addItem(addItemData);
    }
  };

  const availableStock = getAvailableStock();
  const isOutOfStock = enableStockCheck && availableStock <= 0;
  const isDisabled = isOutOfStock || stockLoading;

  // If showing stock status, wrap in container
  if (showStockStatus && enableStockCheck) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* Stock Status Display */}
        <div style={{ fontSize: "0.875rem" }}>
          {stockLoading ? (
            <span style={{ color: "#666" }}>Checking stock...</span>
          ) : isOutOfStock ? (
            <span style={{ color: "#d32f2f", fontWeight: "500" }}>❌ Out of stock</span>
          ) : availableStock < 10 ? (
            <span style={{ color: "#f57c00", fontWeight: "500" }}>⚠️ Only {availableStock} left</span>
          ) : (
            <span style={{ color: "#388e3c" }}>✅ In stock</span>
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