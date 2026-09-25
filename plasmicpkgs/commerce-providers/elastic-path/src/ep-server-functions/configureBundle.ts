import { configureByContextProduct } from "@epcc-sdk/sdks-shopper";
import { buildEpClient, isUsableAuth } from "./ep-client";
import { getCurrentEpSession } from "./session-context";
import { callEpProxy, shouldUseProxy } from "./proxy-fetch";

/**
 * Elastic Path's configured-bundle payload, returned verbatim.
 *
 * Package-owned and open: the configurator reads `data.meta` keys the SDK's
 * `ProductData` does not declare (`bundle_configuration`), and a narrower
 * type would drop them on the way through.
 */
export interface EpConfiguredBundle extends Record<string, unknown> {
  data?: Record<string, unknown>;
  included?: Record<string, unknown>;
}

export interface EpConfigureBundleInput {
  bundleId: string;
  /** Option id -> selected component product id -> quantity. */
  selectedOptions: Record<string, Record<string, number>>;
}

/**
 * Re-prices a bundle for a set of option selections.
 *
 * Reads rather than writes: Elastic Path computes the configured bundle and
 * returns it; nothing is stored. Throws on failure, because a configurator
 * that silently keeps the old price shows the shopper a total that is wrong.
 */
export async function epConfigureBundle({
  bundleId,
  selectedOptions,
}: EpConfigureBundleInput): Promise<EpConfiguredBundle | null> {
  if (!bundleId) return null;
  const auth = getCurrentEpSession();

  if (!isUsableAuth(auth) && shouldUseProxy()) {
    return callEpProxy<EpConfiguredBundle | null>("configureBundle", {
      bundleId,
      selectedOptions,
    });
  }

  if (!isUsableAuth(auth)) {
    throw new Error("epConfigureBundle: no EP session");
  }
  const client = buildEpClient(auth);

  const response = await configureByContextProduct({
    client,
    path: { product_id: bundleId },
    body: { data: { selected_options: selectedOptions } } as any,
  });
  if (response.error) {
    throw new Error(
      `epConfigureBundle: ${
        response.error instanceof Error
          ? response.error.message
          : JSON.stringify(response.error)
      }`
    );
  }
  return (response.data as EpConfiguredBundle) ?? null;
}
