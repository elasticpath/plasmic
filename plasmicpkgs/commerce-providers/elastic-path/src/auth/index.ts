export { createEpAuth } from "./create-ep-auth";
export type { EpAuth, EpAuthConfig, EpAuthResolvedConfig } from "./create-ep-auth";
export { toNextJsHandler } from "./handler";
export { createEpSession } from "./session";
export type { EpSession, EpSessionConfig, EpSessionData } from "./session";
export {
  parseEpTokenCookie,
  buildEpTokenCookieHeader,
  isTokenExpired,
  parseEpAccountCookie,
  buildEpAccountCookieHeader,
  parseEpCartCookie,
  buildEpCartCookieHeader,
} from "./cookies";
export type { EpTokenData, EpAccountData } from "./cookies";
export { resolveEpToken } from "./token";
export { extractEpProviderConfig } from "./extract-ep-provider-config";
export type { EpProviderBundleConfig } from "./extract-ep-provider-config";

// Better-auth-backed implementation (PRD #273). Currently parallel to the
// legacy `createEpAuth` above — consumers opt in by importing
// `createBetterEpAuth` / `epPlugin` directly. The legacy export switches
// over once endpoint parity (account/cart/refresh) is complete.
export { epPlugin } from "./ep-plugin/ep-plugin";
export type { EpPluginOptions } from "./ep-plugin/ep-plugin";
export { createEpAuth as createBetterEpAuth } from "./ep-plugin/create-ep-auth-better";
