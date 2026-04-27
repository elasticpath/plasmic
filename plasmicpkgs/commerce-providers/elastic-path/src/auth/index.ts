/**
 * Public auth surface for `@elasticpath/plasmic-ep-commerce-elastic-path`.
 *
 * After PRD #273, all auth flows through the better-auth-backed plugin
 * implementation in ./ep-plugin/. The legacy hand-rolled
 * createEpSession/handler/cookies/token code has been deleted; consumers
 * mount the auth handler via better-auth's `toNextJsHandler` from
 * `better-auth/next-js`.
 */
export { epPlugin } from "./ep-plugin/ep-plugin";
export type { EpPluginOptions } from "./ep-plugin/ep-plugin";
export {
  createEpAuth,
  createEpAuth as createBetterEpAuth,
} from "./ep-plugin/create-ep-auth-better";
export type {
  EpAuth,
  EpSession,
  EpSessionData,
  CreateEpAuthBetterInput as EpAuthConfig,
} from "./ep-plugin/create-ep-auth-better";
export { epAuthMiddleware } from "./ep-plugin/middleware";
export { createCartRoutes } from "../cart/server-routes";
export type { CartRoutes } from "../cart/server-routes";
export { extractEpProviderConfig } from "./extract-ep-provider-config";
export type { EpProviderBundleConfig } from "./extract-ep-provider-config";
