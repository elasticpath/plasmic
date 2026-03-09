import { useContext } from "react";
import { getShopperContext } from "./ShopperContext";
import type { ShopperOverrides } from "./ShopperContext";

/**
 * Read the current ShopperContext overrides.
 * Returns {} when no ShopperContext provider is above this component.
 */
export function useShopperContext(): ShopperOverrides {
  return useContext(getShopperContext());
}
