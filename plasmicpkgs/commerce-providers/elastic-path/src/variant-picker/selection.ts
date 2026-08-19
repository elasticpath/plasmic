import type { ChildProduct, Product } from "../types/product";

/**
 * A shopper's choices, keyed by variation id and holding the option's display
 * name — the shape the picker writes into the form as `variation_{id}`.
 */
export type SelectedOptionLabels = Record<string, string>;

/** variation id → option name → option id. */
function optionIdsByName(
  product: Pick<Product, "variations">
): Map<string, Map<string, string>> {
  const byVariation = new Map<string, Map<string, string>>();
  for (const variation of product.variations ?? []) {
    const byName = new Map<string, string>();
    for (const option of variation.options ?? []) {
      byName.set(option.name, option.id);
    }
    byVariation.set(variation.id, byName);
  }
  return byVariation;
}

/**
 * The child product a set of choices selects.
 *
 * Matching is on option **ids**, which is what `meta.variation_matrix` yields;
 * names are display strings a merchandiser can rename at any time.
 */
export function findChildProduct(
  product: Pick<Product, "variations" | "childProducts"> | undefined,
  selected: SelectedOptionLabels
): ChildProduct | undefined {
  const children = product?.childProducts ?? [];
  if (!children.length) return undefined;

  const byVariation = optionIdsByName(product!);
  const chosenIds = Object.entries(selected)
    .map(([variationId, name]) => byVariation.get(variationId)?.get(name))
    .filter((id): id is string => !!id);

  if (chosenIds.length !== (product?.variations?.length ?? 0)) {
    return children[0];
  }

  return children.find((child) =>
    chosenIds.every((id) => child.optionIds.includes(id))
  );
}

/**
 * The choices that select a given child product, as the option names the
 * picker renders and writes into the form.
 */
export function initialSelection(
  product: Pick<Product, "variations" | "childProducts"> | undefined,
  childProductId: string | undefined
): SelectedOptionLabels {
  const child = childProductId
    ? product?.childProducts?.find((c) => c.id === childProductId)
    : product?.childProducts?.[0];
  if (!child) return {};

  const selected: SelectedOptionLabels = {};
  for (const variation of product?.variations ?? []) {
    const option = (variation.options ?? []).find((o) =>
      child.optionIds.includes(o.id)
    );
    if (option) selected[variation.id] = option.name;
  }
  return selected;
}
