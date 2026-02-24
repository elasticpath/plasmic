import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useState, useCallback, useEffect, useRef } from "react";
import useUpdateItem from "../cart/use-update-item";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";
import {
  CartItemQuantityContext,
  CartItemQuantityContextValue,
} from "./CartDrawerContext";

const log = createLogger("EPCartItemQuantityControl");

type PreviewState = "auto" | "withData" | "loading" | "minReached";

interface EPCartItemQuantityControlProps {
  children?: React.ReactNode;
  className?: string;
  minQuantity?: number;
  maxQuantity?: number;
  previewState?: PreviewState;
}

export const epCartItemQuantityControlMeta: ComponentMeta<EPCartItemQuantityControlProps> =
  {
    name: "plasmic-commerce-ep-cart-item-quantity-control",
    displayName: "EP Cart Item Quantity Control",
    description:
      "Controls for changing the quantity of a cart item. Wraps increment/decrement buttons and quantity display. Must be inside an EP Cart Item List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [
          {
            type: "component",
            name: "plasmic-commerce-ep-cart-item-quantity-button",
            props: { action: "decrement" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-cart-item-field",
            props: { field: "quantity" },
          },
          {
            type: "component",
            name: "plasmic-commerce-ep-cart-item-quantity-button",
            props: { action: "increment" },
          },
        ],
      },
      minQuantity: {
        type: "number",
        defaultValue: 1,
        displayName: "Min Quantity",
      },
      maxQuantity: {
        type: "number",
        defaultValue: 99,
        displayName: "Max Quantity",
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData", "loading", "minReached"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCartItemQuantityControl",
    providesData: true,
  };

export function EPCartItemQuantityControl(
  props: EPCartItemQuantityControlProps
) {
  const {
    children,
    className,
    minQuantity = 1,
    maxQuantity = 99,
    previewState = "auto",
  } = props;

  const currentItem = useSelector("currentCartItem") as
    | { id: string; quantity: number; locationSlug?: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const updateItem = useUpdateItem();

  const useMock = previewState !== "auto" || (!currentItem && inEditor);

  const mockQuantity =
    previewState === "minReached" ? minQuantity : MOCK_CART_LINE_ITEMS[0].quantity;

  const serverQuantity = useMock ? mockQuantity : (currentItem?.quantity ?? 1);

  const [localQuantity, setLocalQuantity] = useState(serverQuantity);
  const [isLoading, setIsLoading] = useState(false);

  // Sync local state when server data changes (after mutation resolves)
  const prevServerQuantity = useRef(serverQuantity);
  useEffect(() => {
    if (prevServerQuantity.current !== serverQuantity) {
      setLocalQuantity(serverQuantity);
      setIsLoading(false);
      prevServerQuantity.current = serverQuantity;
    }
  }, [serverQuantity]);

  const effectiveIsLoading = useMock
    ? previewState === "loading"
    : isLoading;

  const effectiveQuantity = useMock ? mockQuantity : localQuantity;

  const canDecrement = effectiveQuantity > minQuantity;
  const canIncrement = effectiveQuantity < maxQuantity;

  const doUpdate = useCallback(
    async (newQuantity: number) => {
      if (!currentItem?.id || useMock) return;
      setIsLoading(true);
      try {
        await updateItem({
          id: currentItem.id,
          quantity: newQuantity,
          ...(currentItem.locationSlug && { location: currentItem.locationSlug }),
        } as any);
      } catch (err) {
        // Revert optimistic update on error
        setLocalQuantity(serverQuantity);
        const message =
          err instanceof Error ? err.message : "Failed to update quantity";
        log.error("Quantity update failed", { error: message } as Record<
          string,
          unknown
        >);
      }
    },
    [currentItem?.id, updateItem, useMock, serverQuantity]
  );

  const increment = useCallback(() => {
    if (!canIncrement) return;
    const newQty = effectiveQuantity + 1;
    setLocalQuantity(newQty);
    doUpdate(newQty);
  }, [canIncrement, effectiveQuantity, doUpdate]);

  const decrement = useCallback(() => {
    if (!canDecrement) return;
    const newQty = effectiveQuantity - 1;
    setLocalQuantity(newQty);
    doUpdate(newQty);
  }, [canDecrement, effectiveQuantity, doUpdate]);

  const contextValue: CartItemQuantityContextValue = {
    quantity: effectiveQuantity,
    isLoading: effectiveIsLoading,
    canDecrement,
    canIncrement,
    increment,
    decrement,
  };

  return (
    <CartItemQuantityContext.Provider value={contextValue}>
      <DataProvider
        name="quantityControl"
        data={{
          quantity: effectiveQuantity,
          isLoading: effectiveIsLoading,
          canDecrement,
          canIncrement,
        }}
      >
        <div className={className}>{children}</div>
      </DataProvider>
    </CartItemQuantityContext.Provider>
  );
}

export function registerEPCartItemQuantityControl(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPCartItemQuantityControlProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartItemQuantityControl,
    customMeta ?? epCartItemQuantityControlMeta
  );
}
