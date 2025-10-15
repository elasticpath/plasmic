import { Registerable } from "./registerable";
import { registerCommerceProvider } from "./registerCommerceProvider";
import { registerEPProductVariantPicker } from "./registerEPProductVariantPicker";
export * from "./registerable";
export * from "./registerCommerceProvider";
export * from "./registerEPProductVariantPicker";
export * from "./elastic-path";

export function registerAll(loader?: Registerable) {
  registerCommerceProvider(loader);
  registerEPProductVariantPicker(loader);
}
