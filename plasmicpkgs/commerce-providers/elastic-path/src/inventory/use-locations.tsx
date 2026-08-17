import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { listLocations } from "@epcc-sdk/sdks-shopper";
import { SWR_DEDUPING_INTERVAL_LONG } from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import type { Location, UseLocationsOptions } from "./types";
import { createLogger } from "../utils/logger";

const log = createLogger("useLocations");

export function useLocations({
  type,
  enabled = true,
}: UseLocationsOptions = {}) {
  const commerce = useEpCommerce();
  const client = commerce?.client;

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
      dedupingInterval: SWR_DEDUPING_INTERVAL_LONG,
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
