import { registerCommerceProvider } from "./registerCommerceProvider";
import { registerEPAddToCartButton } from "./registerEPAddToCartButton";
import { registerEPBundleConfigurator } from "./registerEPBundleConfigurator";
import { registerEPMultiLocationStock } from "./registerEPMultiLocationStock";
import { registerEPProductVariantPicker } from "./registerEPProductVariantPicker";
import { registerEPCheckout } from "./registerCheckout";
import { registerEPVariationPicker } from "./variant-picker/EPVariationPicker";
import { registerEPVariationOptionList } from "./variant-picker/EPVariationOptionList";
import { registerEPVariationOptionTrigger } from "./variant-picker/EPVariationOptionTrigger";
import { registerEPVariationField } from "./variant-picker/EPVariationField";
import { registerEPVariationOptionField } from "./variant-picker/EPVariationOptionField";
import { registerEPStockProvider } from "./stock/EPStockProvider";
import { registerEPLocationPicker } from "./stock/EPLocationPicker";
import { registerEPLocationField } from "./stock/EPLocationField";
import { registerEPStockField } from "./stock/EPStockField";
import { registerEPCartField } from "./cart-drawer/EPCartField";
import { registerEPCartItemField } from "./cart-drawer/EPCartItemField";
import { registerEPCartItemImage } from "./cart-drawer/EPCartItemImage";
import { registerEPCartItemRemoveButton } from "./cart-drawer/EPCartItemRemoveButton";
import { registerEPCartItemQuantityButton } from "./cart-drawer/EPCartItemQuantityButton";
import { registerEPCartItemQuantityControl } from "./cart-drawer/EPCartItemQuantityControl";
import { registerEPCartItemList } from "./cart-drawer/EPCartItemList";
import { registerEPCartDrawer } from "./cart-drawer/EPCartDrawer";
import { registerEPCartDrawerTrigger } from "./cart-drawer/EPCartDrawerTrigger";
import { Registerable } from "./registerable";

export * from "./elastic-path";
export * from "./registerCommerceProvider";
export * from "./registerEPAddToCartButton";
export * from "./registerEPBundleConfigurator";
export * from "./registerEPProductVariantPicker";
export * from "./registerCheckout";
export * from "./checkout";
export * from "./registerable";
export * from "./variant-picker";
export * from "./stock";
export * from "./cart-drawer";

export function registerAll(loader?: Registerable) {
  // Global context
  registerCommerceProvider(loader);

  // New composable variant picker
  // Register field components first so they're available as default slot content
  registerEPVariationField(loader);
  registerEPVariationOptionField(loader);
  registerEPVariationPicker(loader);
  registerEPVariationOptionList(loader);
  registerEPVariationOptionTrigger(loader);

  // Add to cart
  registerEPAddToCartButton(loader);

  // New composable stock components
  // Register field components first so they're available as default slot content
  registerEPLocationField(loader);
  registerEPStockField(loader);
  registerEPStockProvider(loader);
  registerEPLocationPicker(loader);

  // Composable cart drawer
  // Register field components first so they're available as default slot content
  registerEPCartField(loader);
  registerEPCartItemField(loader);
  registerEPCartItemImage(loader);
  registerEPCartItemRemoveButton(loader);
  registerEPCartItemQuantityButton(loader);
  registerEPCartItemQuantityControl(loader);
  registerEPCartItemList(loader);
  registerEPCartDrawer(loader);
  registerEPCartDrawerTrigger(loader);

  // Bundle configurator (to be reworked in future)
  registerEPBundleConfigurator(loader);

  // Deprecated — kept for backwards compatibility
  registerEPProductVariantPicker(loader);
  registerEPMultiLocationStock(loader);

  // Checkout
  registerEPCheckout(loader);
}
