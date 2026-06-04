import registerComponent, {
  CanvasComponentProps,
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import {
  FORMAT_CHOICE_OPTIONS,
  SHOW_CHOICE_OPTIONS,
  buildFieldOptions,
  buildTemplateOptions,
} from "./field-catalog";
import type { FormatSpec } from "../../utils/field-format";
import type { ExtensionTemplate } from "../../types/extensions";
import { FieldDisplay, useResolvedField } from "./useResolvedField";

type ShowFacet = "value" | "label";
type PreviewState = "auto" | "withData";

interface ExtensionValueContextData {
  templates: ExtensionTemplate[];
}

interface EPProductExtensionValueProps
  extends CanvasComponentProps<ExtensionValueContextData> {
  template?: string;
  field?: string;
  templateOverride?: string;
  fieldOverride?: string;
  show?: ShowFacet;
  format?: FormatSpec;
  locale?: string;
  children?: React.ReactNode;
  notPresentContent?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epProductExtensionValueMeta: CodeComponentMeta<EPProductExtensionValueProps> =
  {
    name: "plasmic-commerce-ep-product-extension-value",
    displayName: "EP Product Extension Value",
    description:
      "Displays one extension field picked by template then field from dropdowns populated from the current product — no `products(...)` slug or field key typed by hand. The specific-spot counterpart to the iterating EP Product Extension Field. Renders the formatted value as text by default; drop children to gate a section on presence and compose against the resolved value. Must be inside an EP Product Provider.",
    props: {
      template: {
        type: "choice",
        displayName: "Template",
        description:
          "Extension template, from the current product's resolved templates.",
        options: (_props, ctx) =>
          buildTemplateOptions(ctx?.templates as ExtensionTemplate[] | undefined),
        allowSearch: true,
      },
      field: {
        type: "choice",
        displayName: "Field",
        description: "Field within the selected template.",
        options: (props, ctx) =>
          buildFieldOptions(
            ctx?.templates as ExtensionTemplate[] | undefined,
            props.templateOverride || props.template,
          ),
        allowSearch: true,
      },
      show: {
        type: "choice",
        options: SHOW_CHOICE_OPTIONS,
        defaultValue: "value",
        displayName: "Show",
        description:
          "Render the field's value, or its humanized label (for label:value pairs).",
      },
      format: {
        type: "choice",
        options: FORMAT_CHOICE_OPTIONS,
        defaultValue: "auto",
        displayName: "Format",
        description: "How to format the value.",
      },
      locale: {
        type: "string",
        displayName: "Locale",
        description:
          "BCP-47 locale for currency/date/number formatting. Bind to the page language; defaults to en-US.",
        advanced: true,
      },
      templateOverride: {
        type: "string",
        displayName: "Template (override)",
        description:
          "Free-text template slug, e.g. products(iso-standard). Overrides the dropdown — use when the sample product lacks the template.",
        advanced: true,
      },
      fieldOverride: {
        type: "string",
        displayName: "Field (override)",
        description:
          "Free-text field key. Overrides the dropdown — use when the sample product lacks the field.",
        advanced: true,
      },
      children: {
        type: "slot",
        displayName: "Children (section)",
        description:
          "Optional. When present, this becomes a section that renders only when the field is present; descendants read $ctx.currentFieldValue / currentFieldHasValue.",
        hidePlaceholder: true,
      },
      notPresentContent: {
        type: "slot",
        displayName: "Not Present Content",
        description:
          "Rendered when the field is absent on the current product. Leave empty to render nothing.",
        hidePlaceholder: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "withData"],
        defaultValue: "auto",
        displayName: "Preview State",
        description: "Force sample data for design-time editing.",
        advanced: true,
      },
    },
    providesData: true,
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPProductExtensionValue",
  };

export function EPProductExtensionValue(props: EPProductExtensionValueProps) {
  const {
    template,
    field,
    templateOverride,
    fieldOverride,
    show = "value",
    format = "auto",
    locale,
    children,
    notPresentContent,
    className,
    previewState = "auto",
    setControlContextData,
  } = props;

  const templateSlug = (templateOverride || template || "").trim();
  const fieldKey = (fieldOverride || field || "").trim();

  const { resolved, templates, inEditor } = useResolvedField({
    kind: "extension",
    templateSlug,
    fieldKey,
    format,
    locale,
    forceMock: previewState === "withData",
  });

  setControlContextData?.({ templates });

  return (
    <FieldDisplay
      resolved={resolved}
      show={show}
      children={children}
      notPresentContent={notPresentContent}
      className={className}
      inEditor={inEditor}
      dataAttr="data-ep-product-extension-value"
    />
  );
}

export function registerEPProductExtensionValue(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductExtensionValueProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPProductExtensionValue,
    customMeta ?? epProductExtensionValueMeta,
  );
}
