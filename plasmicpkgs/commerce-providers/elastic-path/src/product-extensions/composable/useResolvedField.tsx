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
  resolveHighlightHtml,
} from "../../utils/field-format";
import type { FormatSpec, HighlightMode } from "../../utils/field-format";
import {
  resolveExtensionField,
  resolveTopLevelField,
} from "./resolve-field";
import type { ResolvedField } from "./resolve-field";
import type { ExtensionTemplate } from "../../types/extensions";

type ResolveArgs =
  | {
      kind: "topLevel";
      leafId: string;
      format: FormatSpec;
      locale?: string;
      forceMock?: boolean;
      /** Search-highlight rendering for `name`/`description`; default "off". */
      highlight?: HighlightMode;
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
  /**
   * `<mark>`-wrapped highlight markup to render as HTML instead of the plain
   * value, or `undefined` to render plainly. Only set for top-level
   * `name`/`description` when `highlight` is on/auto and a variant exists.
   */
  highlightHtml?: string;
}

/** Shared host wiring for both field components: read the product, mock in the canvas, delegate to the pure resolvers. */
export function useResolvedField(args: ResolveArgs): UseResolvedFieldResult {
  const liveProduct = useSelector("currentProduct") as Product | undefined;
  const inEditor = !!usePlasmicCanvasContext();
  const useMock = args.forceMock || (!liveProduct && inEditor);
  const product = useMock ? MOCK_PRODUCT : liveProduct;
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
      return resolveTopLevelField(product, args.leafId, args.format, locale);
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
    templates,
    locale,
    args.format,
    args.kind === "topLevel" ? args.leafId : undefined,
    args.kind === "extension" ? args.templateSlug : undefined,
    args.kind === "extension" ? args.fieldKey : undefined,
  ]);

  const highlightHtml = useMemo(() => {
    if (args.kind !== "topLevel" || !args.highlight || args.highlight === "off") {
      return undefined;
    }
    return resolveHighlightHtml(product, args.leafId, args.highlight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.kind,
    args.kind === "topLevel" ? args.leafId : undefined,
    args.kind === "topLevel" ? args.highlight : undefined,
    product,
  ]);

  return { resolved, templates, inEditor, highlightHtml };
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
  /** When set, render this `<mark>` markup as HTML instead of the plain value. */
  highlightHtml?: string;
}) {
  const {
    resolved,
    show,
    children,
    notPresentContent,
    className,
    inEditor,
    dataAttr,
    highlightHtml,
  } = props;
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
    // Highlight markup (search hits) renders the value's `<mark>`-wrapped HTML
    // in place of the plain text. Only `show === "value"` highlights — the
    // humanized label is always plain. The markup comes from Typesense (the
    // search backend), never designer input, so dangerouslySetInnerHTML is
    // contained here rather than handed to designers as an `html:true` footgun.
    if (highlightHtml != null && show !== "label") {
      return (
        <span
          className={className}
          {...{ [dataAttr]: "" }}
          dangerouslySetInnerHTML={{ __html: highlightHtml }}
        />
      );
    }
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
