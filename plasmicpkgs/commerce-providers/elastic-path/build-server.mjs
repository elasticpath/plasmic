/**
 * Builds the server-only entry point (src/server.ts → dist/server.js).
 *
 * Run after tsdx build: "tsdx build && node build-server.mjs"
 *
 * Uses esbuild to bundle server-side code separately from the main
 * client bundle, keeping Node.js-only deps (crypto, stripe) out of
 * browser code.
 */
import { buildSync } from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

// Read package.json to externalize all deps (same as tsdx behavior)
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  "crypto",
  "path",
  "fs",
];

// Bundle server entry
buildSync({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node16",
  external,
  sourcemap: true,
});

// Generate declaration file by re-exporting from tsdx-generated .d.ts files.
// tsc would try to type-check all transitive sources, which may fail on
// third-party type mismatches. Since tsdx already produced correct .d.ts
// files for every module, we just write a re-export declaration.
// Mark the main (client) bundle as "use client" so Next.js RSC creates a
// client boundary when a server component imports this package. tsdx 0.14
// strips directive prologues during its rollup pipeline, so we inject
// after the fact. Without this, Next tries to server-render code
// components like CommerceProviderComponent whose hooks expect a client
// dispatcher — see issue #268 for the failure mode. Only the main
// entry + Next-facing builds get the directive; /server is server-only
// and must not be marked "use client".
const CLIENT_ENTRY_FILES = [
  "dist/plasmic-ep-commerce-elastic-path.cjs.development.js",
  "dist/plasmic-ep-commerce-elastic-path.cjs.production.min.js",
  "dist/plasmic-ep-commerce-elastic-path.esm.js",
];
for (const file of CLIENT_ENTRY_FILES) {
  if (!existsSync(file)) continue;
  const existing = readFileSync(file, "utf8");
  if (existing.startsWith(`"use client"`) || existing.startsWith(`'use client'`)) {
    continue;
  }
  writeFileSync(file, `"use client";\n${existing}`);
  console.log(`✓ Prepended "use client" → ${file}`);
}

// NOTE: keep this re-export surface in lockstep with src/server.ts. tsdx only
// emits .d.ts for the client entry's graph, so the server entry's declaration
// is hand-mirrored here; a missing line means the runtime export works but has
// no type, breaking consumer typechecks.
const dts = `\
export { handleCreateSession, handleGetSession, handleUpdateSession, handleCalculateShipping, handlePay, handleConfirm } from "./api/endpoints/checkout-session";
export { CookieSessionStore } from "./checkout/session/cookie-store";
export { createAdapterRegistry } from "./checkout/session/adapter-registry";
export { createCloverAdapter } from "./checkout/session/adapters/clover-adapter";
export type { CloverAdapterConfig } from "./checkout/session/adapters/clover-adapter";
export { createStripeAdapter } from "./checkout/session/adapters/stripe-adapter";
export type { StripeAdapterConfig } from "./checkout/session/adapters/stripe-adapter";
export { createClientCredentialsTokenResolver } from "./auth/ep-plugin/client-credentials-resolver";
export type { ClientCredentialsResolverConfig, ClientCredentialsTokenResolver } from "./auth/ep-plugin/client-credentials-resolver";
export type { SessionRequest, SessionResponse, SessionHandlerContext, EPCredentials, AdapterRegistry, SessionStore, PaymentAdapter, CustomAttributeAllowList } from "./checkout/session/types";
export { createEpAuth, createBetterEpAuth, extractEpProviderConfig, epPlugin, epAuthMiddleware, createCartRoutes, createEpProxyRoutes } from "./auth";
export type { EpAuth, EpAuthConfig, EpSession, EpProviderBundleConfig, EpPluginOptions, EpProxyRoutes, CreateEpProxyRoutesOptions } from "./auth";
export { epGetProduct, epGetCart, epGetProductList, epGetRelatedProducts, epAddCartItem, epApplyCartAdjustment, epUpdateCartItem, epRemoveCartItem, epPlaceOrder, addCustomCartItem, CART_ADJUSTMENT_KINDS, registerEpCustomFunctions, buildEpCtx, withEpSession, getCurrentEpSession } from "./ep-server-functions";
export type { EpGetProductInput, EpGetCartInput, EpGetProductListInput, EpGetRelatedProductsInput, EpAddCartItemInput, EpApplyCartAdjustmentInput, EpUpdateCartItemInput, EpRemoveCartItemInput, EpPlaceOrderInput, EpPlaceOrderAddress, EpPlaceOrderResult, AddCustomCartItemInput, CartAdjustmentKind, BuildEpCtxSessionInput, EpCtx, EpSessionContext, EpServerAuth } from "./ep-server-functions";
`;

writeFileSync("dist/server.d.ts", dts);
console.log("✓ Server entry built → dist/server.js + dist/server.d.ts");
