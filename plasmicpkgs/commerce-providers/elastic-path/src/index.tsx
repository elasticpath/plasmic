import { registerCommerceProvider } from "./registerCommerceProvider";
import { registerShopperContext } from "./shopper-context/registerShopperContext";
import { registerEPAddToCartButton } from "./registerEPAddToCartButton";
import { registerEPCartProvider } from "./cart-provider/EPCartProvider";
import { registerEPBundleConfigurator } from "./registerEPBundleConfigurator";
import { registerEPMultiLocationStock } from "./registerEPMultiLocationStock";
import { registerEPProductVariantPicker } from "./registerEPProductVariantPicker";
import { registerEPCheckout } from "./registerCheckout";
import { registerEPVariationPicker } from "./variant-picker/EPVariationPicker";
import { registerEPVariationCase } from "./variant-picker/EPVariationCase";
import { registerEPVariationOptionList } from "./variant-picker/EPVariationOptionList";
import { registerEPVariationOptionSelect } from "./variant-picker/EPVariationOptionSelect";
import { registerEPVariationOptionRadioGroup } from "./variant-picker/EPVariationOptionRadioGroup";
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
import { registerEPCartItemQuantitySelect } from "./cart-drawer/EPCartItemQuantitySelect";
import { registerEPCartItemList } from "./cart-drawer/EPCartItemList";
import { registerEPCartDrawer, registerEPCartInline } from "./cart-drawer/EPCartDrawer";
import { registerEPCartPopover } from "./cart-drawer/EPCartPopover";
import { registerEPCartDrawerTrigger } from "./cart-drawer/EPCartDrawerTrigger";
import { registerEPBundleProvider } from "./bundle/composable/EPBundleProvider";
import { registerEPBundleComponentList } from "./bundle/composable/EPBundleComponentList";
import { registerEPBundleComponentField } from "./bundle/composable/EPBundleComponentField";
import { registerEPBundleOptionList } from "./bundle/composable/EPBundleOptionList";
import { registerEPBundleOptionField } from "./bundle/composable/EPBundleOptionField";
import { registerEPBundleOptionTrigger } from "./bundle/composable/EPBundleOptionTrigger";
import { registerEPBundleSelectionIndicator } from "./bundle/composable/EPBundleSelectionIndicator";
import { registerEPBundleOptionQuantityControl } from "./bundle/composable/EPBundleOptionQuantityControl";
import { registerEPBundleOptionQuantityButton } from "./bundle/composable/EPBundleOptionQuantityButton";
import { registerEPBundlePriceField } from "./bundle/composable/EPBundlePriceField";
import { registerEPBundleValidationErrors } from "./bundle/composable/EPBundleValidationErrors";
import { registerEPBundleVariationPicker } from "./bundle/composable/EPBundleVariationPicker";
import { registerEPBundleVariationOptionList } from "./bundle/composable/EPBundleVariationOptionList";
import { registerEPBundleVariationField } from "./bundle/composable/EPBundleVariationField";
import { registerEPBundleVariationOptionTrigger } from "./bundle/composable/EPBundleVariationOptionTrigger";
import { registerEPProductGrid } from "./product-discovery/EPProductGrid";
import { registerEPProductListProvider } from "./product-discovery/EPProductListProvider";
import { registerEPRelatedProductsProvider } from "./product-discovery/EPRelatedProductsProvider";
import { registerEPProductProvider } from "./product/EPProductProvider";
import { registerEPProductExtensionsProvider } from "./product-extensions/composable/EPProductExtensionsProvider";
import { registerEPProductExtensionTemplateList } from "./product-extensions/composable/EPProductExtensionTemplateList";
import { registerEPProductExtensionTemplateField } from "./product-extensions/composable/EPProductExtensionTemplateField";
import { registerEPProductExtensionFieldList } from "./product-extensions/composable/EPProductExtensionFieldList";
import { registerEPProductExtensionField } from "./product-extensions/composable/EPProductExtensionField";
import { registerEPProductField } from "./product-extensions/composable/EPProductField";
import { registerEPProductExtensionValue } from "./product-extensions/composable/EPProductExtensionValue";
import { registerEPSearchBox } from "./catalog-search/EPSearchBox";
import { registerEPSearchHits } from "./catalog-search/EPSearchHits";
import { registerEPRefinementList } from "./catalog-search/EPRefinementList";
import { registerEPHierarchicalMenu } from "./catalog-search/EPHierarchicalMenu";
import { registerEPRangeFilter } from "./catalog-search/EPRangeFilter";
import { registerEPSearchPagination } from "./catalog-search/EPSearchPagination";
import { registerEPSearchStats } from "./catalog-search/EPSearchStats";
import { registerEPSearchSortBy } from "./catalog-search/EPSearchSortBy";
import { registerEPClearRefinements } from "./catalog-search/EPClearRefinements";
import { registerEPCurrentRefinements } from "./catalog-search/EPCurrentRefinements";
import { registerEPSearchEmpty } from "./catalog-search/EPSearchEmpty";
import { registerEPSearchAutocomplete } from "./catalog-search/EPSearchAutocomplete";
import { registerEPSearchAutocompleteInput } from "./catalog-search/EPSearchAutocompleteInput";
import { registerEPSearchAutocompletePanel } from "./catalog-search/EPSearchAutocompletePanel";
import { registerEPSearchAutocompleteList } from "./catalog-search/EPSearchAutocompleteList";
import { registerEPCatalogSearchProvider } from "./catalog-search/EPCatalogSearchProvider";
import { Registerable } from "./registerable";

export * from "./elastic-path";
export * from "./registerCommerceProvider";
export * from "./registerEPAddToCartButton";
export {
  EPCartProvider,
  registerEPCartProvider,
  epCartProviderMeta,
} from "./cart-provider/EPCartProvider";
export { useEpCart } from "./cart-provider/use-ep-cart";
export type { UseEpCartReturn } from "./cart-provider/use-ep-cart";
export {
  epCartCacheKey,
  EP_CART_CACHE_KEY,
} from "./cart-provider/cache-keys";
export type { EpCartCacheKey } from "./cart-provider/cache-keys";
export * from "./registerEPBundleConfigurator";
export * from "./registerEPProductVariantPicker";
export * from "./registerCheckout";
export * from "./checkout";
export * from "./registerable";
export * from "./variant-picker";
export * from "./stock";
export * from "./cart-drawer";
export * from "./bundle/composable";
export * from "./product-discovery";
export * from "./catalog-search";
export * from "./shopper-context";
export * from "./shopper-context/server";
export * from "./product-extensions";

export function registerAll(loader?: Registerable) {
  // Global context
  registerCommerceProvider(loader);
  registerShopperContext(loader);

  // New composable variant picker
  // Register field/leaf components first so they're available as default slot content
  registerEPVariationField(loader);
  registerEPVariationOptionField(loader);
  registerEPVariationOptionTrigger(loader);
  registerEPVariationOptionList(loader);
  registerEPVariationOptionSelect(loader);
  registerEPVariationOptionRadioGroup(loader);
  registerEPVariationCase(loader);
  registerEPVariationPicker(loader);

  // Cart provider — exposes $ctx.cart to descendants
  registerEPCartProvider(loader);

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
  registerEPCartItemQuantitySelect(loader);
  registerEPCartItemList(loader);
  registerEPCartDrawer(loader);
  registerEPCartInline(loader);
  registerEPCartPopover(loader);
  registerEPCartDrawerTrigger(loader);

  // Composable bundle configurator
  // Register field/leaf components first so they're available as default slot content
  registerEPBundleComponentField(loader);
  registerEPBundleOptionField(loader);
  registerEPBundleSelectionIndicator(loader);
  registerEPBundleOptionQuantityButton(loader);
  registerEPBundleVariationField(loader);
  registerEPBundleVariationOptionTrigger(loader);
  registerEPBundleVariationOptionList(loader);
  registerEPBundleVariationPicker(loader);
  registerEPBundleOptionQuantityControl(loader);
  registerEPBundleOptionTrigger(loader);
  registerEPBundleOptionList(loader);
  registerEPBundleComponentList(loader);
  registerEPBundlePriceField(loader);
  registerEPBundleValidationErrors(loader);
  registerEPBundleProvider(loader);

  // Product discovery — register grid first (child) then providers (parents)
  registerEPProductGrid(loader);
  registerEPProductListProvider(loader);
  registerEPRelatedProductsProvider(loader);
  registerEPProductProvider(loader);

  // Product extensions — register field/leaf components first so they're
  // available as default slot content in the parent components above them.
  registerEPProductExtensionField(loader);
  registerEPProductExtensionTemplateField(loader);
  registerEPProductExtensionFieldList(loader);
  registerEPProductExtensionTemplateList(loader);
  registerEPProductExtensionsProvider(loader);
  // Field-display components — pick one field by address (siblings to the iteration components above).
  registerEPProductField(loader);
  registerEPProductExtensionValue(loader);

  // Catalog search — register leaf/field components first, then repeaters, then provider
  registerEPSearchBox(loader);
  registerEPSearchStats(loader);
  registerEPSearchSortBy(loader);
  registerEPSearchHits(loader);
  registerEPRefinementList(loader);
  registerEPHierarchicalMenu(loader);
  registerEPRangeFilter(loader);
  registerEPSearchPagination(loader);
  registerEPClearRefinements(loader);
  registerEPCurrentRefinements(loader);
  registerEPSearchEmpty(loader);
  registerEPSearchAutocomplete(loader);
  registerEPSearchAutocompleteInput(loader);
  registerEPSearchAutocompletePanel(loader);
  registerEPSearchAutocompleteList(loader);
  registerEPCatalogSearchProvider(loader);

  // Legacy monolithic bundle configurator
  registerEPBundleConfigurator(loader);

  // Deprecated — kept for backwards compatibility
  registerEPProductVariantPicker(loader);
  registerEPMultiLocationStock(loader);

  // Checkout
  registerEPCheckout(loader);
}
