import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { Registerable } from "../../registerable";
import {
  FORMAT_CHOICE_OPTIONS,
  SHOW_CHOICE_OPTIONS,
  buildLeafOptions,
} from "./field-catalog";
import type { FormatSpec, HighlightMode } from "../../utils/field-format";
import { FieldDisplay, useResolvedField } from "./useResolvedField";

type ShowFacet = "value" | "label";
type PreviewState = "auto" | "withData";

interface EPProductFieldProps {
  field?: string;
  show?: ShowFacet;
  format?: FormatSpec;
  highlight?: HighlightMode;
  locale?: string;
  children?: React.ReactNode;
  notPresentContent?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epProductFieldMeta: CodeComponentMeta<EPProductFieldProps> = {
  name: "plasmic-commerce-ep-product-field",
  displayName: "EP Product Field",
  description:
    "Displays one top-level product field (name, price, first image, …) picked from a dropdown — no `$ctx.currentProduct…` path. Renders the formatted value as text by default; drop children to gate a whole section on the field's presence and compose against the resolved value. Must be inside an EP Product Provider.",
  props: {
    field: {
      type: "choice",
      options: buildLeafOptions(),
      defaultValue: "name",
      displayName: "Field",
      description: "Which top-level product field to display.",
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
      description:
        "How to format the value. Auto uses the field's natural format (e.g. price → currency). Title case humanizes enum values (e.g. \"in_force\" → \"In Force\").",
    },
    highlight: {
      type: "choice",
      options: [
        { label: "Off", value: "off" },
        { label: "Auto (search hits)", value: "auto" },
        { label: "On (always)", value: "on" },
      ],
      defaultValue: "off",
      displayName: "Search highlight",
      description:
        "For Name/Description inside a search hit: render the <mark>-highlighted match when one exists (plain value otherwise — inert on a PDP). Only the backend's highlight markup is rendered as HTML, never the raw value. Other fields ignore this.",
      advanced: true,
    },
    locale: {
      type: "string",
      displayName: "Locale",
      description:
        "BCP-47 locale for currency/date/number formatting. Bind to the page language; defaults to en-US.",
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
  importName: "EPProductField",
};

export function EPProductField(props: EPProductFieldProps) {
  const {
    field = "name",
    show = "value",
    format = "auto",
    highlight = "off",
    locale,
    children,
    notPresentContent,
    className,
    previewState = "auto",
  } = props;

  const { resolved, inEditor, highlightHtml } = useResolvedField({
    kind: "topLevel",
    leafId: field,
    format,
    highlight,
    locale,
    forceMock: previewState === "withData",
  });

  return (
    <FieldDisplay
      resolved={resolved}
      show={show}
      children={children}
      notPresentContent={notPresentContent}
      className={className}
      inEditor={inEditor}
      dataAttr="data-ep-product-field"
      highlightHtml={highlightHtml}
    />
  );
}

export function registerEPProductField(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPProductFieldProps>,
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPProductField, customMeta ?? epProductFieldMeta);
}
