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

// Client-credentials token resolver (request-scoped, memoized per request).
export {
  createClientCredentialsTokenResolver,
} from "./auth/ep-plugin/client-credentials-resolver";
export type {
  ClientCredentialsResolverConfig,
  ClientCredentialsTokenResolver,
} from "./auth/ep-plugin/client-credentials-resolver";

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
  epAuthMiddleware,
  createCartRoutes,
  createEpProxyRoutes,
} from "./auth";
export type {
  EpAuth,
  EpAuthConfig,
  EpSession,
  EpProviderBundleConfig,
  EpPluginOptions,
  EpProxyRoutes,
  CreateEpProxyRoutesOptions,
} from "./auth";

// Server-side custom functions for Studio Server Queries (PRD #262 / #272)
export {
  epGetProduct,
  epGetCart,
  epGetProductList,
  epGetRelatedProducts,
  epAddCartItem,
  epApplyCartAdjustment,
  epUpdateCartItem,
  epRemoveCartItem,
  epPlaceOrder,
  addCustomCartItem,
  CART_ADJUSTMENT_KINDS,
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
  EpAddCartItemInput,
  EpApplyCartAdjustmentInput,
  EpUpdateCartItemInput,
  EpRemoveCartItemInput,
  EpPlaceOrderInput,
  EpPlaceOrderAddress,
  EpPlaceOrderResult,
  AddCustomCartItemInput,
  CartAdjustmentKind,
  BuildEpCtxSessionInput,
  EpCtx,
  EpSessionContext,
  EpServerAuth,
} from "./ep-server-functions";

// SSR cart-seed helper (consumed in a Next root layout to prime the SWR
// fallback so EPCartProvider has correct data on first paint).
export { seedCartFallback } from "./cart-provider/seed-cart-fallback";
export {
  epCartCacheKey,
  EP_CART_CACHE_KEY,
} from "./cart-provider/cache-keys";
export type { EpCartCacheKey } from "./cart-provider/cache-keys";
