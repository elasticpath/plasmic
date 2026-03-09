import type { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import { ShopperContext, type ShopperContextProps } from "./ShopperContext";
import type { Registerable } from "../registerable";

export const shopperContextMeta: GlobalContextMeta<ShopperContextProps> = {
  name: "plasmic-commerce-ep-shopper-context",
  displayName: "EP Shopper Context",
  description:
    "Override channel for cart identity. Paste a cart UUID for Studio preview. In production, leave empty — the server uses an httpOnly cookie.",
  props: {
    cartId: {
      type: "string",
      displayName: "Cart ID",
      description:
        "Override cart ID for preview. Leave empty for production cookie-based flow.",
    },
    accountId: {
      type: "string",
      displayName: "Account ID",
      description: "Future: logged-in customer ID.",
      advanced: true,
    },
    locale: {
      type: "string",
      displayName: "Locale",
      description: "Future: locale override (e.g., en-US).",
      advanced: true,
    },
    currency: {
      type: "string",
      displayName: "Currency",
      description: "Future: currency override (e.g., USD, GBP).",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "ShopperContext",
};

export function registerShopperContext(loader?: Registerable) {
  const doRegister: typeof registerGlobalContext = (...args) =>
    loader
      ? loader.registerGlobalContext(...args)
      : registerGlobalContext(...args);
  doRegister(ShopperContext, shopperContextMeta);
}
