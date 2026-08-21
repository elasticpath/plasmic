import {
  DataProvider,
  usePlasmicCanvasContext,
  useSelector,
} from "@plasmicapp/host";
import React, { useMemo } from "react";
import { Product } from "../../types/product";
import { MOCK_PRODUCT } from "../../utils/extensions-mock";
import {
  DEFAULT_LOCALE,
  extractRawExtensions,
  normalizeExtensions,
} from "../../utils/field-format";
import type { FormatSpec } from "../../utils/field-format";
import {
  resolveExtensionField,
  resolveTopLevelField,
} from "./resolve-field";
import type { ResolvedField } from "./resolve-field";
import { getProductFieldLeaf, isMoneyLeaf } from "./field-catalog";
import type { ExtensionTemplate } from "../../types/extensions";

type ResolveArgs =
  | {
      kind: "topLevel";
      leafId: string;
      format: FormatSpec;
      locale?: string;
      forceMock?: boolean;
    }
  | {
      kind: "extension";
      templateSlug: string;
      fieldKey: string;
      format: FormatSpec;
      locale?: string;
      forceMock?: boolean;
    };

export interface UseResolvedFieldResult {
  resolved: ResolvedField;
  templates: ExtensionTemplate[];
  inEditor: boolean;
}

/** Shared host wiring for both field components: read the product, mock in the canvas, delegate to the pure resolvers. */
export function useResolvedField(args: ResolveArgs): UseResolvedFieldResult {
  const liveProduct = useSelector("currentProduct") as Product | undefined;
  // The chosen child product, published by EPProductProvider. A variant carries
  // its own price and SKU, so a field that the variant answers must come from
  // the variant — otherwise the page quotes the parent's price and the cart
  // charges the child's.
  const currentVariant = useSelector("currentVariant") as Product | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const useMock = args.forceMock || (!liveProduct && inEditor);
  const product = useMock ? MOCK_PRODUCT : liveProduct;
  const variant = useMock ? undefined : currentVariant;
  const locale = args.locale || DEFAULT_LOCALE;

  const templates = useMemo(
    () =>
      args.kind === "extension"
        ? normalizeExtensions(extractRawExtensions(product))
        : [],
    [args.kind, product],
  );

  const resolved = useMemo(() => {
    if (args.kind === "topLevel") {
      const fromProduct = resolveTopLevelField(
        product,
        args.leafId,
        args.format,
        locale,
      );
      if (!variant) return fromProduct;
      const fromVariant = resolveTopLevelField(
        variant,
        args.leafId,
        args.format,
        locale,
      );
      if (fromVariant.hasValue) return fromVariant;
      // Money belongs to the thing being priced. Once a variant is chosen its
      // price is the only one that applies, so an absent one renders empty
      // rather than falling back to the parent's number.
      const leaf = getProductFieldLeaf(args.leafId);
      if (leaf && isMoneyLeaf(leaf)) return fromVariant;
      return fromProduct;
    }
    return resolveExtensionField(
      templates,
      args.templateSlug,
      args.fieldKey,
      args.format,
      locale,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.kind,
    product,
    variant,
    templates,
    locale,
    args.format,
    args.kind === "topLevel" ? args.leafId : undefined,
    args.kind === "extension" ? args.templateSlug : undefined,
    args.kind === "extension" ? args.fieldKey : undefined,
  ]);

  return { resolved, templates, inEditor };
}

/** Inline scalar with no children; structural section gate with children. Canvas placeholder when unresolvable. */
export function FieldDisplay(props: {
  resolved: ResolvedField;
  show: "value" | "label";
  children?: React.ReactNode;
  notPresentContent?: React.ReactNode;
  className?: string;
  inEditor: boolean;
  dataAttr: string;
}) {
  const { resolved, show, children, notPresentContent, className, inEditor, dataAttr } =
    props;
  const hasChildren = React.Children.count(children) > 0;

  if (hasChildren) {
    if (!resolved.hasValue && !inEditor) {
      return notPresentContent ? (
        <div className={className}>{notPresentContent}</div>
      ) : null;
    }
    return (
      <FieldContextProvider field={resolved}>
        <div className={className} {...{ [dataAttr]: "" }}>
          {children}
        </div>
      </FieldContextProvider>
    );
  }

  if (resolved.hasValue) {
    return (
      <span className={className} {...{ [dataAttr]: "" }}>
        {show === "label" ? resolved.label : resolved.displayValue}
      </span>
    );
  }
  if (inEditor) {
    return (
      <span className={className} data-ep-field-placeholder="">
        {resolved.label || "Pick a field"}
      </span>
    );
  }
  if (notPresentContent) {
    return <span className={className}>{notPresentContent}</span>;
  }
  return null;
}

/** Publishes the resolved field as flat, directly bindable selectors (no optional chaining in bindings). */
export function FieldContextProvider(props: {
  field: ResolvedField;
  children?: React.ReactNode;
}) {
  const { field, children } = props;
  return (
    <DataProvider name="currentFieldValue" data={field.value}>
      <DataProvider name="currentFieldDisplayValue" data={field.displayValue}>
        <DataProvider name="currentFieldLabel" data={field.label}>
          <DataProvider name="currentFieldKey" data={field.key}>
            <DataProvider name="currentFieldType" data={field.type}>
              <DataProvider name="currentFieldHasValue" data={field.hasValue}>
                {children}
              </DataProvider>
            </DataProvider>
          </DataProvider>
        </DataProvider>
      </DataProvider>
    </DataProvider>
  );
}
