import { Registerable } from "./registerable";
import { registerCommerceProvider } from "./registerCommerceProvider";
export * from "./registerable";
export * from "./registerCommerceProvider";
export * from "./elastic-path";

export function registerAll(loader?: Registerable) {
  registerCommerceProvider(loader);
}
