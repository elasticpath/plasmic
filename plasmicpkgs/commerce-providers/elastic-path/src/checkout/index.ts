// Components
export { EPCheckoutForm } from './components/EPCheckoutForm';
export { EPPaymentForm } from './components/EPPaymentForm';
export { EPOrderSummary } from './components/EPOrderSummary';
export { EPCheckoutConfirmation } from './components/EPCheckoutConfirmation';

// Hooks
export { useCheckout } from './hooks/use-checkout';
export { useStripePayment, usePaymentMethod, validateStripePublishableKey, formatStripeError } from './hooks/use-stripe-payment';

// Enums are values, not just types — exporting them via `export type` erases
// them at runtime, so consumers get `undefined` for e.g. `PaymentStatus.Paid`.
export { CheckoutStep, OrderStatus, PaymentStatus } from './types';

// Types
export type {
  CheckoutFormData,
  CheckoutState,
  ElasticPathOrder,
  CustomerData,
  AddressData,
  ShippingRate,
  PaymentSetup,
  APIResponse
} from './types';

// Composable checkout components
export * from './composable';

// Checkout session components. These are registered with `importPath` set to
// the package root, so the loader emits `import { X } from "<pkg>"` and they
// must be reachable from here or esbuild fails to bundle the project.
//
// Exported by name rather than `export * from './session'` on purpose: the
// session barrel also re-exports the Stripe/Clover payment adapters, which are
// server-only and belong to the './server' entry point.
export {
  EPCheckoutSessionProvider,
  registerEPCheckoutSessionProvider,
  epCheckoutSessionProviderMeta,
} from './session/EPCheckoutSessionProvider';
export {
  StripeProvider,
  registerStripeProvider,
  stripeProviderMeta,
} from './session/StripeProvider';
export {
  EPStripePayment,
  registerEPStripePayment,
  epStripePaymentMeta,
} from './session/EPStripePayment';
export {
  EPCloverPayment,
  registerEPCloverPayment,
  epCloverPaymentMeta,
} from './session/EPCloverPayment';
export {
  EPCloverCardNumber,
  registerEPCloverCardNumber,
  epCloverCardNumberMeta,
} from './session/EPCloverCardNumber';
export {
  EPCloverCardExpiry,
  registerEPCloverCardExpiry,
  epCloverCardExpiryMeta,
} from './session/EPCloverCardExpiry';
export {
  EPCloverCardCVV,
  registerEPCloverCardCVV,
  epCloverCardCVVMeta,
} from './session/EPCloverCardCVV';
export {
  EPCloverCardPostalCode,
  registerEPCloverCardPostalCode,
  epCloverCardPostalCodeMeta,
} from './session/EPCloverCardPostalCode';