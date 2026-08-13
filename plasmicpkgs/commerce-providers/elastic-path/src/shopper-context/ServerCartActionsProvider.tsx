import { GlobalActionDict, GlobalActionsProvider } from "@plasmicapp/host";
import React from "react";
import { useAddItem } from "./use-add-item";
import { useRemoveItem } from "./use-remove-item";
import { useUpdateItem } from "./use-update-item";

interface ServerCartActions extends GlobalActionDict {
  addItem: (productId: string, variantId: string, quantity: number) => void;
  updateItem: (lineItemId: string, quantity: number) => void;
  removeItem: (lineItemId: string) => void;
}

/**
 * Replaces CartActionsProvider from @plasmicpkgs/commerce, which drives
 * its hooks from the browser. Cart mutations need the shopper's
 * credentials, which never leave the server.
 */
export function ServerCartActionsProvider(
  props: React.PropsWithChildren<{ globalContextName: string }>
) {
  const addItem = useAddItem();
  const removeItem = useRemoveItem();
  const updateItem = useUpdateItem();

  const actions: ServerCartActions = React.useMemo(
    () => ({
      addItem(productId, variantId, quantity) {
        addItem({ productId, variantId, quantity });
      },
      updateItem(lineItemId, quantity) {
        updateItem(lineItemId, quantity);
      },
      removeItem(lineItemId) {
        removeItem(lineItemId);
      },
    }),
    [addItem, removeItem, updateItem]
  );

  return (
    <GlobalActionsProvider
      contextName={props.globalContextName}
      actions={actions}
    >
      {props.children}
    </GlobalActionsProvider>
  );
}
