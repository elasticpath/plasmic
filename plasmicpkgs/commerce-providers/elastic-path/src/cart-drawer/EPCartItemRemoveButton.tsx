import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useState } from "react";
import { mutate as swrMutate } from "swr";
import { Registerable } from "../registerable";
import { createLogger } from "../utils/logger";
import {
  callEpProxy,
  epProxyErrorCode,
} from "../ep-server-functions/proxy-fetch";
import { cartMutationErrorCopy } from "../ep-server-functions/cart-mutation-error-copy";
import { epCartCacheKey } from "../cart-provider/cache-keys";

const log = createLogger("EPCartItemRemoveButton");

const GENERIC_REMOVE_ERROR =
  "We couldn't remove this item. Please try again.";

type PreviewState = "auto" | "enabled" | "loading" | "error";

interface EPCartItemRemoveButtonProps {
  children?: React.ReactNode;
  className?: string;
  previewState?: PreviewState;
}

export const epCartItemRemoveButtonMeta: CodeComponentMeta<EPCartItemRemoveButtonProps> =
  {
    name: "plasmic-commerce-ep-cart-item-remove-button",
    displayName: "EP Cart Item Remove Button",
    description:
      "Removes the current item from the cart when clicked. Must be inside an EP Cart Item List.",
    props: {
      children: {
        type: "slot",
        defaultValue: [{ type: "text", value: "Remove" }],
      },
      previewState: {
        type: "choice",
        options: ["auto", "enabled", "loading", "error"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state with sample data for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPCartItemRemoveButton",
    providesData: true,
  };

export function EPCartItemRemoveButton(props: EPCartItemRemoveButtonProps) {
  const { children, className, previewState = "auto" } = props;

  const currentItem = useSelector("currentCartItem") as
    | { id: string; name?: string }
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMock = previewState !== "auto";
  const effectiveIsLoading = useMock
    ? previewState === "loading"
    : isLoading;
  const effectiveError = useMock
    ? previewState === "error"
      ? "Sample error message"
      : null
    : error;

  const handleRemove = async () => {
    if (!currentItem?.id || useMock || effectiveIsLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      await callEpProxy("removeCartItem", { itemId: currentItem.id });
      await swrMutate(epCartCacheKey());
      log.info("Item removed from cart", {
        itemId: currentItem.id,
      } as Record<string, unknown>);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to remove item";
      log.error("Remove failed", {
        error: message,
        code: epProxyErrorCode(err),
      } as Record<string, unknown>);
      setError(cartMutationErrorCopy(err, GENERIC_REMOVE_ERROR));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DataProvider
      name="removeItemState"
      data={{ isLoading: effectiveIsLoading, error: effectiveError }}
    >
      <button
        type="button"
        className={className}
        onClick={handleRemove}
        disabled={effectiveIsLoading || (!currentItem && !inEditor && !useMock)}
        aria-label={`Remove ${currentItem?.name ?? "item"} from cart`}
        data-loading={effectiveIsLoading || undefined}
      >
        {children}
      </button>
    </DataProvider>
  );
}

export function registerEPCartItemRemoveButton(
  loader?: Registerable,
  customMeta?: CodeComponentMeta<EPCartItemRemoveButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPCartItemRemoveButton,
    customMeta ?? epCartItemRemoveButtonMeta
  );
}
