import { DataProvider, usePlasmicCanvasContext } from "@plasmicapp/host";
import registerComponent, {
  CodeComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useCallback, useState } from "react";
import { mutate as swrMutate } from "swr";
import { Registerable } from "../../registerable";
import { epCartCacheKey } from "../../cart-provider/cache-keys";
import { useEpCart } from "../../cart-provider/use-ep-cart";
import { cartMutationErrorCopy } from "../../ep-server-functions/cart-mutation-error-copy";
import {
  epApplyPromoCode,
  epRemovePromoCode,
} from "../../ep-server-functions/cart-mutations";
import type { Cart, CartItem } from "../../types/cart";
import { createLogger } from "../../utils/logger";

const log = createLogger("EPPromoCodeInput");

const GENERIC_APPLY_ERROR = "That promo code could not be applied.";
const GENERIC_REMOVE_ERROR = "That promo code could not be removed.";

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
  useServerRoutes?: boolean;
}

export const epPromoCodeInputMeta: CodeComponentMeta<EPPromoCodeInputProps> = {
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
    useServerRoutes: {
      type: "boolean",
      displayName: "Use Server Routes",
      description:
        "No effect. Promo codes always reach Elastic Path through the server; the prop is kept so existing projects still load.",
      advanced: true,
      defaultValue: false,
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

interface AppliedPromotion {
  /** The code Elastic Path keys removal on. Null when EP did not return one. */
  code: string | null;
  /** What the chip shows. */
  label: string | null;
  formattedDiscount: string | null;
}

/**
 * The promotion the cart already carries, which is the only source of truth
 * for the applied state: the discount lives on the EP cart, so local state
 * would lose the chip on navigation while the discount stayed live — and
 * would let the component display a discount the cart does not actually hold.
 */
function readAppliedPromotion(cart: Cart | null): AppliedPromotion | null {
  const promotion = cart?.promotions?.[0] as
    | (CartItem & { code?: string })
    | undefined;
  if (!promotion) return null;
  const code = promotion.code ?? promotion.sku ?? null;
  return {
    code,
    label: code ?? promotion.name ?? null,
    formattedDiscount:
      promotion.meta?.display_price?.without_tax?.value?.formatted ??
      cart?.meta?.display_price?.discount?.formatted ??
      null,
  };
}

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
    previewState = "auto",
    onApply,
    onRemove,
    onError,
  } = props;

  const { cart } = useEpCart();
  const applied = readAppliedPromotion(cart);
  const appliedCode = applied?.code ?? null;

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inEditor = !!usePlasmicCanvasContext();

  const handleApply = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setBusy(true);
    setErrorMessage(null);
    try {
      // Only the code goes over the wire. Elastic Path computes what it is
      // worth and re-prices the cart, so the discount is never a number the
      // browser states.
      const updated = await epApplyPromoCode({ code: trimmed });
      if (updated) {
        await swrMutate(epCartCacheKey(), updated, { revalidate: false });
      } else {
        await swrMutate(epCartCacheKey());
      }
      setCode("");
      log.info("Promo code applied", { code: trimmed } as Record<
        string,
        unknown
      >);
      onApply?.(trimmed);
    } catch (err) {
      const msg = cartMutationErrorCopy(err, GENERIC_APPLY_ERROR);
      setErrorMessage(msg);
      log.warn("Promo code failed", { code: trimmed, error: msg } as Record<
        string,
        unknown
      >);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }, [code, onApply, onError]);

  const handleRemove = useCallback(async () => {
    if (!appliedCode) return;

    setBusy(true);
    setErrorMessage(null);
    try {
      const updated = await epRemovePromoCode({ code: appliedCode });
      if (updated) {
        await swrMutate(epCartCacheKey(), updated, { revalidate: false });
      } else {
        await swrMutate(epCartCacheKey());
      }
      log.info("Promo code removed", { code: appliedCode } as Record<
        string,
        unknown
      >);
      onRemove?.();
    } catch (err) {
      const msg = cartMutationErrorCopy(err, GENERIC_REMOVE_ERROR);
      setErrorMessage(msg);
      log.warn("Promo code remove failed", { error: msg } as Record<
        string,
        unknown
      >);
    } finally {
      setBusy(false);
    }
  }, [appliedCode, onRemove]);

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
          ? {
              ...MOCK_PROMO_DATA,
              state: "error" as PromoState,
              code: "BADCODE",
              errorMessage: "Invalid promo code",
            }
          : {
              ...MOCK_PROMO_DATA,
              state: "idle" as PromoState,
              code: null,
              formattedDiscount: null,
              errorMessage: null,
            };

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

  // An applied promotion outranks a stale error: the chip has to stay while a
  // failed *removal* is reported, or the shopper is offered the input for a
  // discount the cart still holds.
  const state: PromoState = busy
    ? "loading"
    : applied
      ? "applied"
      : errorMessage
        ? "error"
        : "idle";

  const promoData = {
    code: applied?.label ?? null,
    state,
    formattedDiscount: applied?.formattedDiscount ?? null,
    errorMessage,
  };

  return (
    <DataProvider name="promoCodeData" data={promoData}>
      <div className={className} data-ep-promo-code="">
        {applied ? (
          <div className={appliedClassName} data-ep-promo-applied="">
            <span>{applied.label}</span>
            {applied.formattedDiscount && (
              <span> — {applied.formattedDiscount}</span>
            )}
            <button
              type="button"
              className={buttonClassName}
              onClick={handleRemove}
              disabled={busy || !appliedCode}
            >
              {busy ? "..." : removeLabel}
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
                setErrorMessage(null);
              }}
              onKeyDown={handleKeyDown}
              disabled={busy}
            />
            <button
              type="button"
              className={buttonClassName}
              onClick={handleApply}
              disabled={busy || !code.trim()}
            >
              {busy ? "..." : applyLabel}
            </button>
          </>
        )}
        {errorMessage && (
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
  customMeta?: CodeComponentMeta<EPPromoCodeInputProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPPromoCodeInput, customMeta ?? epPromoCodeInputMeta);
}
