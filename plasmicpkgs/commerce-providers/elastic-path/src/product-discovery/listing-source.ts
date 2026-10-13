import React from "react";

export type ListingSource = "product-grid-data" | "catalog-search";

export const ListingSourceContext = React.createContext<
  ListingSource | undefined
>(undefined);
