import type { BundleConfiguration } from "@epcc-sdk/sdks-shopper";
import type { SelectedOption } from "../../types/cart";
import type { Product } from "../../types/product";

/** The arguments `ep.addCartItem` takes. */
export interface AddCartItemArgs {
  /** The product being added — the chosen child product, or the product itself. */
  productId: string;
  quantity: number;
  bundleConfiguration?: BundleConfiguration;
  location?: string;
  customInputs?: Record<string, unknown>;
}

/**
 * Form values from React Hook Form context.
 * Includes an index signature because the variant picker writes dynamic
 * keys like `variation_{variationId}` into the form.
 */
export interface CartFormValues {
  ProductQuantity?: number;
  ProductVariant?: string;
  BundleConfiguration?: BundleConfiguration;
  SelectedLocationSlug?: string;
  [key: string]: unknown;
}

/**
 * Props for add to cart button component
 */
export interface AddToCartButtonProps {
  locationId?: string;
  locationSlug?: string;
}
/**
 * Resolves the target location slug from form values and props
 * @param formValues Current form values
 * @param props Component props
 * @returns Location slug to use, or undefined
 */
export function resolveLocationSlug(
  formValues: CartFormValues,
  props: AddToCartButtonProps
): string | undefined {
  // Priority: form context > prop slug > prop ID (as fallback)
  return formValues.SelectedLocationSlug || props.locationSlug || props.locationId;
}

/**
 * Reads the variation picker's form values back into the option labels a
 * shopper chose, so the cart can show "Size: Small" after the round trip.
 */
function extractSelectedOptions(
  formValues: CartFormValues,
  product: Pick<Product, "variations"> | undefined
): SelectedOption[] {
  const options: SelectedOption[] = [];
  for (const variation of product?.variations ?? []) {
    const selected = formValues[`variation_${variation.id}`];
    if (typeof selected === "string" && selected) {
      options.push({ id: variation.id, name: variation.name, value: selected });
    }
  }
  return options;
}

/**
 * Builds the `ep.addCartItem` arguments from the product form.
 *
 * A cart line always references a child product, so the picker's selection wins;
 * failing that the first child, and for a simple product the product itself.
 */
export function extractCartItemFromForm(
  formValues: CartFormValues,
  product: Product | undefined,
  props: AddToCartButtonProps
): AddCartItemArgs {
  if (!product?.id) {
    throw new Error("Product ID is required for cart item");
  }

  const location = resolveLocationSlug(formValues, props);
  const selectedOptions = extractSelectedOptions(formValues, product);

  return {
    productId:
      formValues.ProductVariant ?? product.childProducts?.[0]?.id ?? product.id,
    quantity: Math.max(1, formValues.ProductQuantity ?? 1),
    ...(formValues.BundleConfiguration && {
      bundleConfiguration: formValues.BundleConfiguration,
    }),
    ...(location && { location }),
    ...(selectedOptions.length > 0 && {
      customInputs: { _selectedOptions: selectedOptions },
    }),
  };
}

/**
 * Validates quantity from form input
 * @param quantityValue Raw quantity value from form
 * @returns Validation result with parsed quantity
 */
export function validateAndParseQuantity(quantityValue: any): {
  isValid: boolean;
  quantity: number;
  errorMessage?: string;
} {
  const quantity = Number(quantityValue);

  if (isNaN(quantity)) {
    return {
      isValid: false,
      quantity: 0,
      errorMessage: "The item quantity has to be a valid number",
    };
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    return {
      isValid: false,
      quantity,
      errorMessage: "The item quantity has to be a valid integer greater than 0",
    };
  }

  return {
    isValid: true,
    quantity,
  };
}
