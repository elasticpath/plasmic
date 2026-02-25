import React, { useContext, useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Module-level singleton store for drawer open/close state.
// Allows EPCartDrawerTrigger (site header) and EPCartDrawer (page body)
// to communicate without requiring shared React ancestry.
// ---------------------------------------------------------------------------

type DrawerListener = (isOpen: boolean) => void;
const drawerListeners = new Set<DrawerListener>();
let drawerIsOpen = false;

export function getDrawerOpen(): boolean {
  return drawerIsOpen;
}

export function setDrawerOpen(open: boolean): void {
  if (drawerIsOpen === open) return;
  drawerIsOpen = open;
  drawerListeners.forEach((fn) => fn(open));
}

export function toggleDrawer(): void {
  setDrawerOpen(!drawerIsOpen);
}

export function subscribeDrawerState(fn: DrawerListener): () => void {
  drawerListeners.add(fn);
  return () => {
    drawerListeners.delete(fn);
  };
}

/**
 * Hook to sync a component to the module-level drawer open/close state.
 * Compatible with React 16+.
 */
export function useDrawerOpen(): [boolean, typeof setDrawerOpen] {
  const [isOpen, setIsOpen] = useState(getDrawerOpen);
  useEffect(() => subscribeDrawerState(setIsOpen), []);
  return [isOpen, setDrawerOpen];
}

// ---------------------------------------------------------------------------
// QuantityContext — shared between EPCartItemQuantityControl and
// EPCartItemQuantityButton, following the VariationPickerContext pattern.
// ---------------------------------------------------------------------------

export interface CartItemQuantityContextValue {
  quantity: number;
  isLoading: boolean;
  canDecrement: boolean;
  canIncrement: boolean;
  increment: () => void;
  decrement: () => void;
}

export const CartItemQuantityContext =
  React.createContext<CartItemQuantityContextValue | null>(null);

export function useCartItemQuantity(): CartItemQuantityContextValue | null {
  return useContext(CartItemQuantityContext);
}
