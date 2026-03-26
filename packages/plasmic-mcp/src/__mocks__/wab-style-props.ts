/**
 * Mock for @/wab/shared/core/style-props
 *
 * Exports the constant property lists used by edit-tools.ts for CSS property
 * validation. Values mirror the real module — update if upstream changes.
 */

export const GAP_PROPS = ["column-gap", "row-gap"];

export const FLEX_CONTAINER_PROPS = [
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "align-content",
];

export const gridCssProps = [
  "grid-template-rows",
  "grid-template-columns",
  "grid-row-gap",
  "grid-column-gap",
  "grid-auto-rows",
  "grid-auto-columns",
];

export const gridChildProps = [
  "grid-row-start",
  "grid-row-end",
  "grid-column-start",
  "grid-column-end",
];

export const imageCssProps = ["object-fit", "object-position"];

export const transitionProps = [
  "transition-property",
  "transition-timing-function",
  "transition-duration",
  "transition-delay",
];

export const inheritableTypographyCssProps = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "color",
  "text-align",
  "text-transform",
  "line-height",
  "letter-spacing",
  "white-space",
  "user-select",
];

export const nonInheritableTypographCssProps = [
  "text-decoration-line",
  "text-overflow",
];

export const typographyCssProps = [
  ...inheritableTypographyCssProps,
  ...nonInheritableTypographCssProps,
];

export const colorProps = [
  "color",
  "border-left-color",
  "border-right-color",
  "border-top-color",
  "border-bottom-color",
];

export const spacingProps = [
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "column-gap",
  "row-gap",
];

export const contentLayoutProps = ["justify-items", "align-content"];
export const contentLayoutChildProps = ["justify-self"];
export const flexChildProps = ["align-self"];
