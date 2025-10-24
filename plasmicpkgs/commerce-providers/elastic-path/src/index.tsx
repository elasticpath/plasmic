import { Registerable } from "./registerable";
import { registerCommerceProvider } from "./registerCommerceProvider";
import { registerEPProductVariantPicker } from "./registerEPProductVariantPicker";
import { registerEPBundleConfigurator } from "./registerEPBundleConfigurator";
import { registerEPAddToCartButton } from "./registerEPAddToCartButton";
export * from "./registerable";
export * from "./registerCommerceProvider";
export * from "./registerEPProductVariantPicker";
export * from "./registerEPBundleConfigurator";
export * from "./registerEPAddToCartButton";
export * from "./elastic-path";

export function registerAll(loader?: Registerable) {
  registerCommerceProvider(loader);
  registerEPProductVariantPicker(loader);
  registerEPBundleConfigurator(loader);
  registerEPAddToCartButton(loader);
}
