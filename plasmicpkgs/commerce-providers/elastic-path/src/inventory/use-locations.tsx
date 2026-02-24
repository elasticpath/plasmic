import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { listLocations } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import type { Location, UseLocationsOptions } from "./types";
import { createLogger } from "../utils/logger";

const log = createLogger("useLocations");

export function useLocations({
  type,
  enabled = true,
}: UseLocationsOptions = {}) {
  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;

  const queryKey = enabled && client
    ? ["ep-locations", type ?? "__all__"]
    : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Location[],
    Error
  >(
    queryKey,
    async () => {
      const response = await listLocations({
        client: client!,
        query: type ? { filter: `eq(type,${type})` } : {},
      });
      return response.data?.data || [];
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 5 * 60 * 1000, // 5 minutes
      onError: (err: Error) => {
        log.error("Error fetching locations", {
          error: err.message,
        } as Record<string, unknown>);
      },
    }
  );

  const locations = useMemo(() => data ?? [], [data]);

  return {
    locations,
    loading: isLoading ?? false,
    error: error ?? null,
    refetch: () => mutate(),
  };
}
