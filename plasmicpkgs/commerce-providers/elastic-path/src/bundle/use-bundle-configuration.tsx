import { useCallback, useState } from "react";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import {
  epConfigureBundle,
  type EpConfiguredBundle,
} from "../ep-server-functions/configureBundle";

interface UseBundleConfigurationOptions {
  bundleId: string;
  onSuccess?: (response: EpConfiguredBundle) => void;
  onError?: (error: Error) => void;
}

export function useBundleConfiguration({
  bundleId,
  onSuccess,
  onError,
}: UseBundleConfigurationOptions) {
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [configuredBundle, setConfiguredBundle] =
    useState<EpConfiguredBundle | null>(null);
  const commerce = useEpCommerce();

  const configureBundleSelection = useCallback(
    async (selectedOptions: Record<string, Record<string, number>>) => {
      setIsConfiguring(true);
      setError(null);

      try {
        if (!commerce) {
          throw new Error("No Elastic Path Provider is configured");
        }

        const result = await epConfigureBundle({ bundleId, selectedOptions });
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
