import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useState } from "react";
import {
  manageCarts,
  deleteAPromotionViaPromotionCode,
} from "@epcc-sdk/sdks-shopper";
import { Registerable } from "../../registerable";
import { useCommerce } from "../../elastic-path";
import { getCartId } from "../../utils/cart-cookie";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPPromoCodeInput");

type PromoState = "idle" | "loading" | "applied" | "error";

interface EPPromoCodeInputProps {
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  appliedClassName?: string;
  errorClassName?: string;
  placeholder?: string;
  applyLabel?: string;
  removeLabel?: string;
  onApply?: (code: string) => void;
  onRemove?: () => void;
  onError?: (message: string) => void;
  previewState?: "auto" | "idle" | "applied" | "error";
}

export const epPromoCodeInputMeta: ComponentMeta<EPPromoCodeInputProps> = {
  name: "plasmic-commerce-ep-promo-code-input",
  displayName: "EP Promo Code Input",
  description:
    "Promo/discount code input with EP promotions API integration. Validates and applies codes to the cart.",
  props: {
    inputClassName: {
      type: "class",
      displayName: "Input Style",
    },
    buttonClassName: {
      type: "class",
      displayName: "Button Style",
    },
    appliedClassName: {
      type: "class",
      displayName: "Applied Badge Style",
    },
    errorClassName: {
      type: "class",
      displayName: "Error Style",
    },
    placeholder: {
      type: "string",
      defaultValue: "Promo code",
      displayName: "Placeholder",
    },
    applyLabel: {
      type: "string",
      defaultValue: "Apply",
      displayName: "Apply Button Label",
    },
    removeLabel: {
      type: "string",
      defaultValue: "Remove",
      displayName: "Remove Button Label",
    },
    onApply: {
      type: "eventHandler" as const,
      argTypes: [{ name: "code", type: "string" }],
    },
    onRemove: {
      type: "eventHandler" as const,
      argTypes: [],
    },
    onError: {
      type: "eventHandler" as const,
      argTypes: [{ name: "message", type: "string" }],
    },
    previewState: {
      type: "choice",
      options: ["auto", "idle", "applied", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPPromoCodeInput",
  providesData: true,
};

const MOCK_PROMO_DATA = {
  code: "SAVE10",
  state: "applied" as PromoState,
  formattedDiscount: "-$10.00",
  errorMessage: null as string | null,
};

export function EPPromoCodeInput(props: EPPromoCodeInputProps) {
  const {
    className,
    inputClassName,
    buttonClassName,
    appliedClassName,
    errorClassName,
    placeholder = "Promo code",
    applyLabel = "Apply",
    removeLabel = "Remove",
    onApply,
    onRemove,
    onError,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();
  const commerce = useCommerce();
  const client = commerce.providerRef.current?.client;

  const [code, setCode] = useState("");
  const [state, setState] = useState<PromoState>("idle");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleApply = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setState("loading");
    setErrorMessage(null);

    try {
      const cartId = getCartId();
      if (!cartId) {
        throw new Error("No cart found");
      }

      await manageCarts({
        client: client!,
        path: { cartID: cartId },
        body: {
          data: {
            type: "promotion_item",
            code: trimmed,
          } as any,
        },
      });

      setState("applied");
      setAppliedCode(trimmed);
      setCode("");
      log.info("Promo code applied", { code: trimmed } as Record<string, unknown>);
      onApply?.(trimmed);
    } catch (err) {
      const e = err as any;
      const msg =
        e?.body?.errors?.[0]?.detail ??
        e?.message ??
        "Invalid promo code";
      setState("error");
      setErrorMessage(msg);
      log.warn("Promo code failed", { code: trimmed, error: msg } as Record<string, unknown>);
      onError?.(msg);
    }
  }, [code, client, onApply, onError]);

  const handleRemove = useCallback(async () => {
    if (!appliedCode) return;

    setState("loading");

    try {
      const cartId = getCartId();
      if (!cartId) {
        throw new Error("No cart found");
      }

      await deleteAPromotionViaPromotionCode({
        client: client!,
        path: { cartID: cartId, promoCode: appliedCode },
      });

      setState("idle");
      setAppliedCode(null);
      setErrorMessage(null);
      log.info("Promo code removed", { code: appliedCode } as Record<string, unknown>);
      onRemove?.();
    } catch (err) {
      setState("error");
      const e = err as any;
      const msg = e?.message ?? "Failed to remove promo code";
      setErrorMessage(msg);
      log.warn("Promo code remove failed", { error: msg } as Record<string, unknown>);
    }
  }, [appliedCode, client, onRemove]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  };

  // Design-time preview
  if (inEditor && previewState !== "auto") {
    const mockData =
      previewState === "applied"
        ? MOCK_PROMO_DATA
        : previewState === "error"
          ? { ...MOCK_PROMO_DATA, state: "error" as PromoState, code: "BADCODE", errorMessage: "Invalid promo code" }
          : { ...MOCK_PROMO_DATA, state: "idle" as PromoState, code: null, formattedDiscount: null, errorMessage: null };

    return (
      <DataProvider name="promoCodeData" data={mockData}>
        <div className={className} data-ep-promo-code="">
          {previewState === "applied" ? (
            <div className={appliedClassName} data-ep-promo-applied="">
              <span>SAVE10</span>
              <span> — -$10.00</span>
              <button type="button" className={buttonClassName}>
                {removeLabel}
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                className={inputClassName}
                placeholder={placeholder}
                value={previewState === "error" ? "BADCODE" : ""}
                readOnly
              />
              <button type="button" className={buttonClassName}>
                {applyLabel}
              </button>
            </>
          )}
          {previewState === "error" && (
            <div className={errorClassName} role="alert">
              Invalid promo code
            </div>
          )}
        </div>
      </DataProvider>
    );
  }

  const promoData = {
    code: appliedCode,
    state,
    formattedDiscount: appliedCode ? "-$10.00" : null,
    errorMessage,
  };

  return (
    <DataProvider name="promoCodeData" data={promoData}>
      <div className={className} data-ep-promo-code="">
        {state === "applied" && appliedCode ? (
          <div className={appliedClassName} data-ep-promo-applied="">
            <span>{appliedCode}</span>
            <button
              type="button"
              className={buttonClassName}
              onClick={handleRemove}
            >
              {removeLabel}
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              className={inputClassName}
              placeholder={placeholder}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (state === "error") {
                  setState("idle");
                  setErrorMessage(null);
                }
              }}
              onKeyDown={handleKeyDown}
              disabled={state === "loading"}
            />
            <button
              type="button"
              className={buttonClassName}
              onClick={handleApply}
              disabled={state === "loading" || !code.trim()}
            >
              {state === "loading" ? "..." : applyLabel}
            </button>
          </>
        )}
        {state === "error" && errorMessage && (
          <div className={errorClassName} role="alert">
            {errorMessage}
          </div>
        )}
      </div>
    </DataProvider>
  );
}

export function registerEPPromoCodeInput(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPPromoCodeInputProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPPromoCodeInput, customMeta ?? epPromoCodeInputMeta);
}
