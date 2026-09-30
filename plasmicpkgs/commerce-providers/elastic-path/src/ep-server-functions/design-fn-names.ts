/**
 * The catalog operations the session-free design-time route serves.
 *
 * Declared here, never derived from the proxy's dispatch table. A name on this
 * list is readable by anyone with the store's public client id; subtracting
 * from the proxy's table instead would make the next session-scoped operation
 * anonymously readable by omission.
 */
export const EP_DESIGN_FN_NAMES = [
  "getProduct",
  "getProductList",
  "getProductPage",
  "getRelatedProducts",
] as const;

export type EpDesignFnName = (typeof EP_DESIGN_FN_NAMES)[number];

export function isEpDesignFnName(name: string): name is EpDesignFnName {
  return (EP_DESIGN_FN_NAMES as readonly string[]).indexOf(name) !== -1;
}

/**
 * Why a name is refused, in one sentence, from the one list that decides it.
 * The route and the browser transport both answer with this; the transport
 * adds where the binding *is* checkable.
 */
export function epDesignFnNotServedMessage(fnName: string): string {
  return (
    `ep design: "${fnName}" is not served at design time. The design-time ` +
    `route reads no shopper session, so it serves only the catalog reads ` +
    `${EP_DESIGN_FN_NAMES.join(", ")}.`
  );
}
