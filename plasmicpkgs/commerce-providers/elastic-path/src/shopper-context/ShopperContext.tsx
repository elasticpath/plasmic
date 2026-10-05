import React from "react";

/**
 * Inert. Every reader is gone: cart identity lives in the shopper envelope on
 * the server, and no prop here reaches it. The component stays registered
 * because hostless publishing rejects a removed global context — emptying the
 * body is what stops a prop being re-threaded into a context nobody reads.
 */
export interface ShopperContextProps {
  cartId?: string;
  accountId?: string;
  locale?: string;
  currency?: string;
  children?: React.ReactNode;
}

export function ShopperContext({ children }: ShopperContextProps) {
  return <>{children}</>;
}
