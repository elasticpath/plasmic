import React from "react";

/**
 * Which provider supplies the listing an EP Product Grid sits in. The nearest
 * provider wins, so a product-list provider nested inside catalog search
 * still feeds its grid.
 */
export type ListingSource = "product-list" | "catalog-search";

export const ListingSourceContext = React.createContext<
  ListingSource | undefined
>(undefined);
