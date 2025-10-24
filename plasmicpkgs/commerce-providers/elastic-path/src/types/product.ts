import { ProductTypes as Core } from '@plasmicpkgs/commerce'
import type { ProductData } from '@epcc-sdk/sdks-shopper'

export type ProductImage = Core.ProductImage;

export type ProductPrice = Core.ProductPrice;

export type ProductOption = Core.ProductOption;

export type ProductOptionValues = Core.ProductOptionValues;

export type ProductVariant = Core.ProductVariant;

export type Product = Core.Product & {
  rawData?: ProductData;
};

export type SearchProductsBody = Core.SearchProductsBody;

export type ProductTypes = Core.ProductTypes;

export type SearchProductsHook = Core.SearchProductsHook;

export type ProductsSchema = Core.ProductsSchema;

export type GetAllProductPathsOperation = Core.GetAllProductPathsOperation;

export type GetAllProductsOperation = Core.GetAllProductsOperation;

export type GetProductOperation = Core.GetProductOperation;