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

export function epDesignFnNotServedMessage(fnName: string): string {
  return (
    `ep design: "${fnName}" is not served at design time. The design-time ` +
    `route reads no shopper session, so it serves only the catalog reads ` +
    `${EP_DESIGN_FN_NAMES.join(", ")}.`
  );
}
