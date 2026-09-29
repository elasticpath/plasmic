import { useMemo } from "react";
import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { SWR_DEDUPING_INTERVAL_LONG } from "../const";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetLocations } from "../ep-server-functions/getLocations";
import type { Location, UseLocationsOptions } from "./types";
import { createLogger } from "../utils/logger";

const log = createLogger("useLocations");

export function useLocations({
  type,
  enabled = true,
}: UseLocationsOptions = {}) {
  const commerce = useEpCommerce();

  const queryKey = enabled && commerce
    ? ["ep-locations", type ?? "__all__"]
    : null;

  const { data, error, isLoading, mutate } = useMutablePlasmicQueryData<
    Location[],
    Error
  >(
    queryKey,
    async () => {
      const locations = await epGetLocations({ type });
      return locations as unknown as Location[];
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
