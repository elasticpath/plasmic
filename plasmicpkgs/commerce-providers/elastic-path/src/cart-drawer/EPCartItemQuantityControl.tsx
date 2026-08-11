import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { mutate as swrMutate } from "swr";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import { MOCK_CART_LINE_ITEMS } from "../utils/design-time-data";
import {
  callEpProxy,
  epProxyErrorCode,
} from "../ep-server-functions/proxy-fetch";
import { epCartCacheKey } from "../cart-provider/cache-keys";
import type { Cart } from "../types/cart";
import {
  CartItemQuantityContext,
  CartItemQuantityContextValue,
} from "./CartDrawerContext";

const log = createLogger("EPCartItemQuantityControl");

type PreviewState = "auto" | "withData" | "loading" | "minReached" | "error";

interface EPCartItemQuantityControlProps {
  children?: React.ReactNode;
  className?: string;
  minQuantity?: number;
  maxQuantity?: number;
  previewState?: PreviewState;
}

export const epCartItemQuantityControlMeta: CodeComponentMeta<EPCartItemQuantityControlProps> =
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
        options: ["auto", "withData", "loading", "minReached", "error"],
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
    | {
        id: string;
        quantity: number;
        locationSlug?: string;
        stockAvailable?: number | null;
      }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const useMock = previewState !== "auto" || (!currentItem && inEditor);

  const mockQuantity =
    previewState === "minReached" ? minQuantity : MOCK_CART_LINE_ITEMS[0].quantity;

  const serverQuantity = useMock
    ? mockQuantity
    : Number(currentItem?.quantity ?? 1);

  const [localQuantity, setLocalQuantity] = useState(serverQuantity);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a stock-rejection from EP on an *increment*, remember the highest
  // qty that succeeded so we stop offering + even when stockAvailable isn't
  // on the line item.
  const [stockCap, setStockCap] = useState<number | null>(null);
  const inFlightRef = useRef(false);
  const quantityRef = useRef(serverQuantity);
  const itemIdRef = useRef(currentItem?.id);
  // Keep the location slug across SWR refreshes that may briefly omit it —
  // multilocation updates require it on every write.
  const locationRef = useRef<string | undefined>(
    currentItem?.locationSlug?.trim() || undefined
  );
  quantityRef.current = localQuantity;
  if (currentItem?.locationSlug?.trim()) {
    locationRef.current = currentItem.locationSlug.trim();
  }

  // Sync local state when server data changes (after mutation resolves)
  const prevServerQuantity = useRef(serverQuantity);
  useEffect(() => {
    if (prevServerQuantity.current !== serverQuantity) {
      setLocalQuantity(serverQuantity);
      quantityRef.current = serverQuantity;
      if (!inFlightRef.current) {
        setIsLoading(false);
      }
      prevServerQuantity.current = serverQuantity;
    }
  }, [serverQuantity]);

  // New line-item identity → reset busy + stock-cap + error state.
  useEffect(() => {
    if (itemIdRef.current !== currentItem?.id) {
      itemIdRef.current = currentItem?.id;
      inFlightRef.current = false;
      setIsLoading(false);
      setError(null);
      setStockCap(null);
      locationRef.current = currentItem?.locationSlug?.trim() || undefined;
      if (currentItem?.quantity != null) {
        const q = Number(currentItem.quantity);
        setLocalQuantity(q);
        quantityRef.current = q;
        prevServerQuantity.current = q;
      }
    }
  }, [currentItem?.id, currentItem?.quantity, currentItem?.locationSlug]);

  const effectiveIsLoading = useMock
    ? previewState === "loading"
    : isLoading;
  const effectiveError = useMock
    ? previewState === "error"
      ? "Sample error message"
      : null
    : error;

  const effectiveQuantity = useMock ? mockQuantity : localQuantity;

  // Prefer live stock from the line item; fall back to a cap learned from
  // an EP "not enough stock" rejection on a prior increment.
  const stockAvailable =
    typeof currentItem?.stockAvailable === "number"
      ? currentItem.stockAvailable
      : null;
  const effectiveMax = Math.min(
    maxQuantity,
    stockAvailable ?? stockCap ?? maxQuantity
  );

  const canDecrement = effectiveQuantity > minQuantity;
  const canIncrement = effectiveQuantity < effectiveMax;

  const doUpdate = useCallback(
    async (newQuantity: number) => {
      const itemId = itemIdRef.current ?? currentItem?.id;
      if (!itemId || useMock) return;
      if (inFlightRef.current) return;
      // Snapshot the last known-good qty before this write. Optimistic UI
      // already moved quantityRef to newQuantity.
      const previousQty = prevServerQuantity.current;
      const location =
        locationRef.current ||
        currentItem?.locationSlug?.trim() ||
        undefined;
      inFlightRef.current = true;
      setError(null);
      setIsLoading(true);
      try {
        const updated = await callEpProxy<Cart | null>("updateCartItem", {
          itemId,
          quantity: newQuantity,
          ...(location ? { location } : {}),
        });
        // Seeding the cache with an empty result would blank the cart, since
        // `revalidate: false` leaves nothing to correct it. Revalidate instead.
        if (updated) {
          await swrMutate(epCartCacheKey(), updated, { revalidate: false });
        } else {
          await swrMutate(epCartCacheKey());
        }
        setLocalQuantity(newQuantity);
        quantityRef.current = newQuantity;
        prevServerQuantity.current = newQuantity;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update quantity";
        log.error("Quantity update failed", { error: message } as Record<
          string,
          unknown
        >);
        setError(message);

        const revertTo = Math.max(minQuantity, Number(previousQty) || minQuantity);
        setLocalQuantity(revertTo);
        quantityRef.current = revertTo;
        prevServerQuantity.current = revertTo;

        // Only freeze + when an increment was rejected for stock — a
        // decrement can also fail that way when location is missing, and that
        // must not permanently disable +. Branch on the code, not the message:
        // the proxy withholds messages in production.
        if (
          epProxyErrorCode(err) === "insufficient_stock" &&
          newQuantity > previousQty
        ) {
          setStockCap(revertTo);
        }

        // Refresh cart so UI matches EP after a failed write.
        try {
          await swrMutate(epCartCacheKey());
        } catch {
          // ignore revalidation errors
        }
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [
      currentItem?.id,
      currentItem?.locationSlug,
      useMock,
      minQuantity,
    ]
  );

  const increment = useCallback(() => {
    if (inFlightRef.current) return;
    const current = quantityRef.current;
    if (current >= effectiveMax) return;
    const newQty = current + 1;
    setLocalQuantity(newQty);
    quantityRef.current = newQty;
    void doUpdate(newQty);
  }, [effectiveMax, doUpdate]);

  const decrement = useCallback(() => {
    if (inFlightRef.current) return;
    const current = quantityRef.current;
    if (current <= minQuantity) return;
    const newQty = current - 1;
    setLocalQuantity(newQty);
    quantityRef.current = newQty;
    void doUpdate(newQty);
  }, [minQuantity, doUpdate]);

  const setQuantity = useCallback(
    (next: number) => {
      if (inFlightRef.current) return;
      const clamped = Math.min(
        effectiveMax,
        Math.max(minQuantity, Math.trunc(Number(next)))
      );
      if (clamped === quantityRef.current) return;
      setLocalQuantity(clamped);
      quantityRef.current = clamped;
      void doUpdate(clamped);
    },
    [minQuantity, effectiveMax, doUpdate]
  );

  const contextValue: CartItemQuantityContextValue = {
    quantity: effectiveQuantity,
    isLoading: effectiveIsLoading,
    canDecrement,
    canIncrement,
    minQuantity,
    maxQuantity: effectiveMax,
    increment,
    decrement,
    setQuantity,
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
          error: effectiveError,
        }}
      >
        <div className={className}>{children}</div>
      </DataProvider>
    </CartItemQuantityContext.Provider>
  );
}

export function registerEPCartItemQuantityControl(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartItemQuantityControlProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartItemQuantityControl,
    customMeta ?? epCartItemQuantityControlMeta
  );
}
