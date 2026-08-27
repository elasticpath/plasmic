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
  handleCalculateShipping,
  handleConfirm,
  handleCreateSession,
  handleGetSession,
  handlePay,
  handleUpdateSession,
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
export { createClientCredentialsTokenResolver } from "./auth/ep-plugin/client-credentials-resolver";
export type {
  ClientCredentialsResolverConfig,
  ClientCredentialsTokenResolver,
} from "./auth/ep-plugin/client-credentials-resolver";

// Types needed by consumer route files
export type {
  AdapterRegistry,
  EPCredentials,
  PaymentAdapter,
  SessionHandlerContext,
  SessionRequest,
  SessionResponse,
  SessionStore,
} from "./checkout/session/types";

// Auth — better-auth-backed (PRD #273). Mount the handler via
// `createEpAuthRoutes`, not better-auth's `toNextJsHandler` directly:
// the raw handler's /get-session returns the shopper's EP access token.
export {
  DEFAULT_HOST_ALLOWLIST,
  assertProductionSecret,
  createBetterEpAuth,
  createCartRoutes,
  createEpAuth,
  createEpAuthRoutes,
  createEpProxyRoutes,
  enforceOriginGate,
  epAuthMiddleware,
  epPlugin,
  extractEpProviderConfig,
  isAllowedEpHost,
  isTrustedOrigin,
  passesOriginGate,
  resolveAuthSecret,
} from "./auth";
export type {
  EpAuth,
  EpAuthConfig,
  EpPluginOptions,
  EpProviderBundleConfig,
  EpProxyRoutes,
  EpSession,
  ExtractEpProviderConfigOptions,
} from "./auth";

// Bare names registered with Studio (`ep.getProduct`). `registerFunction`
// has no `importName`, so generated loader code imports these exact
// symbols from this entry.
export {
  addCartItem,
  applyCartAdjustment,
  getCart,
  getProduct,
  getProductList,
  getProductPage,
  getRelatedProducts,
  removeCartItem,
  updateCartItem,
} from "./ep-server-functions";

// Server-side custom functions for Studio Server Queries (PRD #262 / #272)
export {
  CART_ADJUSTMENT_KINDS,
  addCustomCartItem,
  buildEpCtx,
  epAddCartItem,
  epApplyCartAdjustment,
  epGetCart,
  epGetProduct,
  epGetProductList,
  epGetProductPage,
  epGetRelatedProducts,
  epPlaceOrder,
  epRemoveCartItem,
  epUpdateCartItem,
  getCurrentEpSession,
  registerEpCustomFunctions,
  withEpSession,
} from "./ep-server-functions";
export type {
  AddCustomCartItemInput,
  BuildEpCtxSessionInput,
  CartAdjustmentKind,
  EpAddCartItemInput,
  EpApplyCartAdjustmentInput,
  EpCtx,
  EpGetCartInput,
  EpGetProductInput,
  EpGetProductListInput,
  EpGetProductPageInput,
  EpProductPage,
  EpGetRelatedProductsInput,
  EpPlaceOrderAddress,
  EpPlaceOrderInput,
  EpPlaceOrderResult,
  EpRemoveCartItemInput,
  EpServerAuth,
  EpSessionContext,
  EpUpdateCartItemInput,
} from "./ep-server-functions";

// SSR cart-seed helper (consumed in a Next root layout to prime the SWR
// fallback so EPCartProvider has correct data on first paint).
export { EP_CART_CACHE_KEY, epCartCacheKey } from "./cart-provider/cache-keys";
export type { EpCartCacheKey } from "./cart-provider/cache-keys";
export { seedCartFallback } from "./cart-provider/seed-cart-fallback";
