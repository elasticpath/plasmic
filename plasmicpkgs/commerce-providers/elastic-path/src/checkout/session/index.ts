/**
 * Checkout session — public API surface.
 *
 * Server-side: handler functions, session store, adapter registry, types.
 * Client-side: EPCheckoutSessionProvider component, useCheckoutSession hook.
 */

// Component
export {
  EPCheckoutSessionProvider,
  epCheckoutSessionProviderMeta,
  registerEPCheckoutSessionProvider,
} from "./EPCheckoutSessionProvider";

// Hook
export { useCheckoutSession } from "./use-checkout-session";
export type { UseCheckoutSessionReturn } from "./use-checkout-session";

// Payment registration context
export {
  PaymentRegistrationContext,
  usePaymentRegistration,
} from "./payment-registration-context";
export type {
  PaymentRegistrationContextValue,
  GatewayRegistration,
} from "./payment-registration-context";

// Session store
export { CookieSessionStore } from "./cookie-store";

// Adapter registry
export { createAdapterRegistry } from "./adapter-registry";

// Address utils
export { toEPAddress, fromEPAddress, toEPCustomer } from "./address-utils";
export type { EPAddress } from "./address-utils";

// Cart hash
export { hashCart } from "./cart-hash";

// Design-time data
export { getMockSession } from "./design-time-data";
export type { PreviewState } from "./design-time-data";

// Clover payment components
export {
  EPCloverPayment,
  epCloverPaymentMeta,
  registerEPCloverPayment,
  handleClover3DS,
} from "./EPCloverPayment";
export {
  EPCloverCardNumber,
  epCloverCardNumberMeta,
  registerEPCloverCardNumber,
} from "./EPCloverCardNumber";
export {
  EPCloverCardExpiry,
  epCloverCardExpiryMeta,
  registerEPCloverCardExpiry,
} from "./EPCloverCardExpiry";
export {
  EPCloverCardCVV,
  epCloverCardCVVMeta,
  registerEPCloverCardCVV,
} from "./EPCloverCardCVV";
export {
  EPCloverCardPostalCode,
  epCloverCardPostalCodeMeta,
  registerEPCloverCardPostalCode,
} from "./EPCloverCardPostalCode";

// Clover context
export { CloverElementsContext, useCloverElements } from "./clover-context";
export type { CloverElementsContextValue } from "./clover-context";

// Clover SDK singletons
export { getOrCreateCloverInstance, createToken, destroyCloverInstance } from "./clover-singleton";
export { loadClover3DSSDK, getClover3DSUtil, waitForExecutePatch } from "./clover-3ds-sdk";

// Stripe payment component
export {
  EPStripePayment,
  epStripePaymentMeta,
  registerEPStripePayment,
} from "./EPStripePayment";

// Adapters
export { createCloverAdapter } from "./adapters/clover-adapter";
export type { CloverAdapterConfig } from "./adapters/clover-adapter";
export { createStripeAdapter } from "./adapters/stripe-adapter";
export type { StripeAdapterConfig } from "./adapters/stripe-adapter";

// Types
export type {
  CheckoutSession,
  CheckoutSessionStatus,
  PaymentStatus,
  SessionAddress,
  SessionCustomerInfo,
  SessionShippingRate,
  SessionTotals,
  SessionPayment,
  SessionOrder,
  PaymentAdapter,
  PaymentAdapterResult,
  PaymentAdapterResultStatus,
  SessionStore,
  SessionSetResult,
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  EPCredentials,
  AdapterRegistry,
  ClientCheckoutSession,
  CreateSessionRequest,
  UpdateSessionRequest,
  PayRequest,
  ConfirmRequest,
} from "./types";
