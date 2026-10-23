import { mutate } from "swr";
import { registerEpCartCache } from "../ep-server-functions/cart-cache-registry";
import { epCartCacheKey } from "./cache-keys";

registerEpCartCache(mutate, {
  show: (cart) => mutate(epCartCacheKey(), cart, { revalidate: false }),
  refetch: () => mutate(epCartCacheKey()),
});
