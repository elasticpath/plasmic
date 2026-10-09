import type { GlobalContextMeta } from "@plasmicapp/host";
import registerGlobalContext from "@plasmicapp/host/registerGlobalContext";
import { ShopperContext } from "./ShopperContext";
import type { ShopperContextProps } from "./ShopperContext";
import type { Registerable } from "../registerable";

const DEPRECATED = "Deprecated — ignored.";

export const shopperContextMeta: GlobalContextMeta<ShopperContextProps> = {
  name: "plasmic-commerce-ep-shopper-context",
  displayName: "EP Shopper Context (deprecated)",
  description:
    "Does nothing. It used to override cart identity from the page; the shopper's cart, account, locale and currency now come from the session the server holds, and nothing here can change them. Remove it from your project.",
  props: {
    cartId: {
      type: "string",
      displayName: "Cart ID",
      description:
        `${DEPRECATED} There is no replacement: a cart is addressed by its id ` +
        "alone, so a cart id a page can set is a cart a page can take over.",
      hidden: () => true,
    },
    accountId: {
      type: "string",
      displayName: "Account ID",
      description:
        `${DEPRECATED} Sign an account member in with the account login ` +
        "operation; the server selects the account and scopes pricing to it.",
      hidden: () => true,
      advanced: true,
    },
    locale: {
      type: "string",
      displayName: "Locale",
      description: `${DEPRECATED} Set Locale on the Elastic Path Provider.`,
      hidden: () => true,
      advanced: true,
    },
    currency: {
      type: "string",
      displayName: "Currency",
      description: `${DEPRECATED} The storefront server chooses the currency with createEpAuth's resolveLocaleAndCurrency.`,
      hidden: () => true,
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
