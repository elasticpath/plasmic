import { useEffect, useState } from "react";
import { listLocations } from "@epcc-sdk/sdks-shopper";
import { useCommerce } from "../elastic-path";
import type { Location, UseLocationsOptions } from "./types";

export function useLocations({
  type,
  enabled = true,
}: UseLocationsOptions = {}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const commerce = useCommerce();

  useEffect(() => {
    if (!enabled || !commerce.providerRef.current?.client) {
      return;
    }

    const fetchLocations = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await listLocations({
          client: commerce.providerRef.current.client,
          query: type ? { filter: `eq(type,${type})` } : {},
        });

        const locationData = response.data?.data || [];
        setLocations(locationData);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Failed to fetch locations");
        setError(error);
        console.error("Error fetching locations:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLocations();
  }, [type, enabled, commerce]);

  return {
    locations,
    loading,
    error,
    refetch: () => {
      if (enabled && commerce.providerRef.current?.client) {
        setLoading(true);
        setError(null);
      }
    },
  };
}