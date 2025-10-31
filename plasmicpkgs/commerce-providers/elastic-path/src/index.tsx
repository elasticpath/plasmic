import { registerCommerceProvider } from "./registerCommerceProvider";
import { registerEPAddToCartButton } from "./registerEPAddToCartButton";
import { registerEPBundleConfigurator } from "./registerEPBundleConfigurator";
import { registerEPMultiLocationStock } from "./registerEPMultiLocationStock";
import { registerEPProductVariantPicker } from "./registerEPProductVariantPicker";
import { Registerable } from "./registerable";
export * from "./elastic-path";
export * from "./registerCommerceProvider";
export * from "./registerEPAddToCartButton";
export * from "./registerEPBundleConfigurator";
export * from "./registerEPProductVariantPicker";
export * from "./registerable";

export function registerAll(loader?: Registerable) {
  registerCommerceProvider(loader);
  registerEPProductVariantPicker(loader);
  registerEPBundleConfigurator(loader);
  registerEPAddToCartButton(loader);
  registerEPMultiLocationStock(loader);
}
