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
 * Provides global cart actions (addItem, updateItem, removeItem) using
 * server-route hooks from shopper-context instead of the deprecated
 * client-side EP SDK hooks.
 *
 * Drop-in replacement for CartActionsProvider from @plasmicpkgs/commerce
 * when serverCartMode is enabled.
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
