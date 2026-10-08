import { GlobalActionDict, GlobalActionsProvider } from "@plasmicapp/host";
import React from "react";
import { DEFAULT_DEBOUNCE_MS } from "../const";
import {
  epAddCartItem,
  epRemoveCartItem,
  epUpdateCartItem,
} from "../ep-server-functions/cart-mutations";
import { createLogger } from "../utils/logger";

const log = createLogger("ServerCartActionsProvider");

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
  // Rapid +/- clicks land as one write.
  const updateTimer = React.useRef<ReturnType<typeof setTimeout>>();

  React.useEffect(
    () => () => {
      if (updateTimer.current) clearTimeout(updateTimer.current);
    },
    []
  );

  const actions: ServerCartActions = React.useMemo(
    () => ({
      addItem(productId, variantId, quantity) {
        // A line references the child product when one was chosen.
        epAddCartItem({ productId: variantId || productId, quantity }).catch(
          (err) => {
            log.error("Add to cart failed", {
              error: err instanceof Error ? err.message : String(err),
            } as Record<string, unknown>);
          }
        );
      },
      updateItem(lineItemId, quantity) {
        if (updateTimer.current) clearTimeout(updateTimer.current);
        updateTimer.current = setTimeout(() => {
          epUpdateCartItem({ itemId: lineItemId, quantity }).catch((err) => {
            log.error("Cart quantity update failed", {
              error: err instanceof Error ? err.message : String(err),
            } as Record<string, unknown>);
          });
        }, DEFAULT_DEBOUNCE_MS);
      },
      removeItem(lineItemId) {
        epRemoveCartItem({ itemId: lineItemId }).catch((err) => {
          log.error("Cart item removal failed", {
            error: err instanceof Error ? err.message : String(err),
          } as Record<string, unknown>);
        });
      },
    }),
    []
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
