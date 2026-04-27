/**
 * Server-only entry point for checkout session API route consumers.
 *
 * Import from "@elasticpath/plasmic-ep-commerce-elastic-path/server"
 * in Next.js API routes (or other server-side code).
 *
 * This entry is built separately from the main client bundle to avoid
 * pulling Node.js-only dependencies (crypto, stripe) into browser code.
 */

// Handler functions
export {
  handleCreateSession,
  handleGetSession,
  handleUpdateSession,
  handleCalculateShipping,
  handlePay,
  handleConfirm,
} from "./api/endpoints/checkout-session";

// Session store
export { CookieSessionStore } from "./checkout/session/cookie-store";

// Adapter registry
export { createAdapterRegistry } from "./checkout/session/adapter-registry";

// Payment gateway adapters
export { createCloverAdapter } from "./checkout/session/adapters/clover-adapter";
export type { CloverAdapterConfig } from "./checkout/session/adapters/clover-adapter";
export { createStripeAdapter } from "./checkout/session/adapters/stripe-adapter";
export type { StripeAdapterConfig } from "./checkout/session/adapters/stripe-adapter";

// Types needed by consumer route files
export type {
  SessionRequest,
  SessionResponse,
  SessionHandlerContext,
  EPCredentials,
  AdapterRegistry,
  SessionStore,
  PaymentAdapter,
} from "./checkout/session/types";

// Auth — better-auth-backed (PRD #273). Mount the handler via
// `toNextJsHandler` from `better-auth/next-js`, NOT a helper exported
// from this package.
export {
  createEpAuth,
  createBetterEpAuth,
  extractEpProviderConfig,
  epPlugin,
} from "./auth";
export type {
  EpAuth,
  EpAuthConfig,
  EpSession,
  EpProviderBundleConfig,
  EpPluginOptions,
} from "./auth";

// Server-side custom functions for Studio Server Queries (PRD #262 / #272)
export {
  epGetProduct,
  epGetCart,
  epGetProductList,
  epGetRelatedProducts,
  registerEpCustomFunctions,
  buildEpCtx,
  withEpSession,
  getCurrentEpSession,
} from "./ep-server-functions";
export type {
  EpGetProductInput,
  EpGetCartInput,
  EpGetProductListInput,
  EpGetRelatedProductsInput,
  BuildEpCtxSessionInput,
  EpCtx,
  EpSessionContext,
  EpServerAuth,
} from "./ep-server-functions";
