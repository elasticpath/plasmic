import { ProductData, configureByContextProduct } from "@epcc-sdk/sdks-shopper";
import { useCallback, useState } from "react";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { BundleConfiguration } from "./types";

interface UseBundleConfigurationOptions {
  bundleId: string;
  onSuccess?: (response: ProductData) => void;
  onError?: (error: Error) => void;
}

export function useBundleConfiguration({
  bundleId,
  onSuccess,
  onError,
}: UseBundleConfigurationOptions) {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [configuredBundle, setConfiguredBundle] = useState<ProductData | null>(
    null
  );
  const commerce = useEpCommerce();

  const configureBundleSelection = useCallback(
    async (selectedOptions: Record<string, Record<string, number>>) => {
      setIsConfiguring(true);
      setError(null);

      try {
        if (!commerce) {
          throw new Error("No Elastic Path Provider is configured");
        }

        // The SDK types say BigInt but the serializer can't handle it
        // Pass numbers directly and let the SDK handle it
        const response = await configureByContextProduct({
          client: commerce.client,
          path: { product_id: bundleId },
          body: {
            data: {
              // SDK types expect BigInt values but JSON serialization requires numbers
              selected_options: selectedOptions as unknown as Record<string, Record<string, BigInt>>,
            },
          },
        });

        const result = response.data;
        if (result) {
          setConfiguredBundle(result);
          onSuccess?.(result);
        }

        return result;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to configure bundle");
        setError(error);
        onError?.(error);
        throw error;
      } finally {
        setIsConfiguring(false);
      }
    },
    [bundleId, commerce, onSuccess, onError]
  );

  return {
    configureBundleSelection,
    isConfiguring,
    error,
    configuredBundle,
  };
}
