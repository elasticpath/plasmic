/**
 * Hands the page request's Elastic Path session to code that cannot reach it
 * any other way: the loader bundle inlines its own copy of this package, so
 * its server pass never sees the storefront's `withEpSession` scope, and the
 * server render of a client component runs after that scope has ended.
 *
 * `createEpAuth` registers the bridge in the storefront's server process. The
 * slot is on `globalThis` so every copy of the package finds it. This module
 * imports nothing server-only, so the browser bundle can read the slot (and
 * always finds it empty).
 */
import type { EpCtx } from "./build-ep-ctx";

export interface EpRequestBridge {
  version: 1;
  /** The page request's session, or null outside a request scope. */
  requestSession(): Promise<EpCtx | null>;
  /** The page request's CSP nonce, if it has one. */
  requestNonce(): Promise<string | undefined>;
}

const BRIDGE_KEY = Symbol.for("@elasticpath/ep-request-bridge");

type BridgeScope = { [BRIDGE_KEY]?: unknown };

export function registerEpRequestBridge(bridge: EpRequestBridge): void {
  (globalThis as BridgeScope)[BRIDGE_KEY] = bridge;
}

/** Null when no storefront registered a bridge this copy understands. */
export function readEpRequestBridge(): EpRequestBridge | null {
  const bridge = (globalThis as BridgeScope)[BRIDGE_KEY] as
    | Partial<EpRequestBridge>
    | undefined;
  if (
    !bridge ||
    bridge.version !== 1 ||
    typeof bridge.requestSession !== "function" ||
    typeof bridge.requestNonce !== "function"
  ) {
    return null;
  }
  return bridge as EpRequestBridge;
}
