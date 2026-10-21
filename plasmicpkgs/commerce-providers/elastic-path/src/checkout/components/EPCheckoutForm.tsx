/**
 * Inert. It posted to `/checkout/create-order`, which nothing serves, so it
 * could not place an order. It stays registered because hostless publishing
 * rejects a removed component or prop (ADR-0004). EPCheckoutSessionProvider
 * is the checkout path.
 */
import React from "react";

interface EPCheckoutFormProps {
  /** @deprecated Ignored. */
  cartId?: string;
  /** @deprecated Ignored. */
  apiBaseUrl?: string;
  /** @deprecated Ignored. */
  onComplete?: (order: any) => void;
  /** @deprecated Ignored. */
  onError?: (error: Error) => void;
  /** @deprecated Ignored. */
  className?: string;
  /** @deprecated Ignored. */
  style?: React.CSSProperties;
}

/** @deprecated Renders nothing. Build checkout with EPCheckoutSessionProvider. */
export function EPCheckoutForm(_props: EPCheckoutFormProps): React.JSX.Element {
  return <></>;
}

export default EPCheckoutForm;
