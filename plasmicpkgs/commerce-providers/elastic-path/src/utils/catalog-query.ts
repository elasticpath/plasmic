/**
 * The array format Elastic Path's catalog endpoints take, for example
 * `include=main_image,files`.
 *
 * The SDK sets this per operation from its OpenAPI spec. An operation whose
 * spec omits the array parameter (the related-products endpoint has no
 * `include`) falls back to the client default and sends
 * `include=main_image&include=files` instead. Pass this as the call's
 * `querySerializer` to match the other catalog calls.
 */
export const EP_COMMA_ARRAY_QUERY = {
  array: { explode: false, style: "form" },
} as const;
