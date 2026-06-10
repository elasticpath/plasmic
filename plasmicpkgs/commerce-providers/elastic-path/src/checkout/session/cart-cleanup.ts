/**
 * Cart Cleanup Operation — runs after a successful order is created.
 *
 * Slice 1: anonymous guest only — delete the EP cart. The next add-to-cart
 * action lazily creates a fresh cart through the existing cart-routes path.
 *
 * Failures are logged but never propagated. The order is genuine; cleanup
 * is housekeeping.
 */
import { deleteACart, createShopperClient } from "@epcc-sdk/sdks-shopper";
import { createLogger } from "../../utils/logger";

const log = createLogger("CartCleanup");

export interface CartCleanupConfig {
  host: string;
  clientId: string;
  getClientCredentialsToken: () => Promise<string>;
  cartId: string;
}

export async function runCartCleanup(config: CartCleanupConfig): Promise<void> {
  const { host, clientId, getClientCredentialsToken, cartId } = config;
  if (!cartId) return;

  try {
    const adminToken = await getClientCredentialsToken();
    const { client } = createShopperClient(
      { baseUrl: host },
      {
        clientId,
        storage: {
          get: () => adminToken,
          set: () => {},
        },
      }
    );
    await deleteACart({ client, path: { cartID: cartId } });
  } catch (err) {
    log.warn("Cart cleanup failed (non-fatal)", {
      cartId,
      error: err instanceof Error ? err.message : String(err),
    } as Record<string, unknown>);
  }
}
