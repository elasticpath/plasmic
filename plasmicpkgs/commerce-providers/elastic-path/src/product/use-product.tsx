import { useMutablePlasmicQueryData } from "@plasmicapp/query";
import { useEpCommerce } from "../shopper-context/EpCommerceContext";
import { epGetProduct } from "../ep-server-functions/getProduct";
import type { Product } from "../types/product";

export type GetProductInput = {
  id?: string;
};

export default function useProduct(input: GetProductInput = {}) {
  const commerce = useEpCommerce();
  const { id } = input;

  const key = commerce && id ? ["ep-product", id] : null;
  const query = useMutablePlasmicQueryData<Product | null, Error>(
    key,
    () => epGetProduct({ id: id! }),
    { revalidateOnFocus: false }
  );
  // A null key reads as loading forever; no read is running.
  return key ? query : { ...query, isLoading: false };
}
