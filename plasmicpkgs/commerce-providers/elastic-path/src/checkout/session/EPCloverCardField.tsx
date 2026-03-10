/**
 * EPCloverCardField — shared internal component for all 4 Clover card field types.
 *
 * WHY: Card number, expiry, CVV, and postal code fields share identical logic:
 * mount a Clover iframe, apply styles, handle design-time placeholders.
 * This shared component avoids 4x code duplication.
 *
 * Not exported directly — wrapped by EPCloverCardNumber, EPCloverCardExpiry,
 * EPCloverCardCVV, and EPCloverCardPostalCode.
 */
import React, { useEffect, useId, useRef } from "react";
import { usePlasmicCanvasContext } from "@plasmicapp/host";
import { createLogger } from "../../utils/logger";
import { useCloverElements } from "./clover-context";
import type { CloverFieldType, CloverFieldInstance } from "./adapters/clover-types";

const log = createLogger("EPCloverCardField");

export interface CloverCardFieldStyleProps {
  className?: string;
  placeholder?: string;
  inputFontFamily?: string;
  inputFontSize?: string;
  inputColor?: string;
  inputPadding?: string;
  fieldHeight?: string;
  fieldBorderColor?: string;
  fieldBorderRadius?: string;
  errorColor?: string;
}

interface EPCloverCardFieldInternalProps extends CloverCardFieldStyleProps {
  fieldType: CloverFieldType;
  designLabel: string;
}

export function EPCloverCardFieldInternal(props: EPCloverCardFieldInternalProps) {
  const {
    fieldType,
    designLabel,
    className,
    placeholder,
    inputFontFamily,
    inputFontSize = "16px",
    inputColor = "#333333",
    inputPadding = "12px",
    fieldHeight = "44px",
    fieldBorderColor = "#d1d5db",
    fieldBorderRadius = "6px",
    errorColor = "#dc2626",
  } = props;

  const inEditor = usePlasmicCanvasContext();
  const ctx = useCloverElements();
  const containerId = useId();
  const mountId = `clover-field-${fieldType}-${containerId}`.replace(/:/g, "-");
  const fieldRef = useRef<CloverFieldInstance | null>(null);

  // ── Design-time placeholder ───────────────────────────────────────
  if (inEditor) {
    return (
      <div
        className={className}
        style={{
          height: fieldHeight,
          border: `1px solid ${fieldBorderColor}`,
          borderRadius: fieldBorderRadius,
          padding: inputPadding,
          fontFamily: inputFontFamily || "inherit",
          fontSize: inputFontSize,
          color: "#9ca3af",
          display: "flex",
          alignItems: "center",
          backgroundColor: "#ffffff",
          boxSizing: "border-box",
        }}
      >
        {placeholder || designLabel}
      </div>
    );
  }

  // ── No context warning ────────────────────────────────────────────
  if (!ctx) {
    log.warn(
      `${fieldType} placed outside EPCloverPayment — rendering placeholder`
    );
    return (
      <div className={className} style={{ height: fieldHeight }}>
        <span style={{ color: errorColor, fontSize: "12px" }}>
          Place inside EPCloverPayment
        </span>
      </div>
    );
  }

  // ── Mount Clover iframe ───────────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!ctx.elements || !ctx.isReady) return;

    // Build Clover style config
    const styles: Record<string, Record<string, string>> = {};
    const inputStyles: Record<string, string> = {};
    if (inputFontFamily) inputStyles.fontFamily = inputFontFamily;
    if (inputFontSize) inputStyles.fontSize = inputFontSize;
    if (inputColor) inputStyles.color = inputColor;
    if (inputPadding) inputStyles.padding = inputPadding;
    if (Object.keys(inputStyles).length > 0) {
      styles["input"] = inputStyles;
    }

    try {
      const field = ctx.elements.create(fieldType, styles);
      fieldRef.current = field;

      // Delay mount slightly to ensure DOM is ready
      requestAnimationFrame(() => {
        const el = document.getElementById(mountId);
        if (el) {
          field.mount(`#${mountId}`);
        }
      });
    } catch (err) {
      log.error(`Failed to create ${fieldType} field`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return () => {
      if (fieldRef.current) {
        try {
          fieldRef.current.destroy();
        } catch {
          // Field may already be cleaned up
        }
        fieldRef.current = null;
      }
    };
  }, [ctx.elements, ctx.isReady, fieldType, mountId, inputFontFamily, inputFontSize, inputColor, inputPadding]);

  return (
    <div
      className={className}
      style={{
        height: fieldHeight,
        border: `1px solid ${fieldBorderColor}`,
        borderRadius: fieldBorderRadius,
        overflow: "hidden",
        backgroundColor: "#ffffff",
        boxSizing: "border-box",
      }}
    >
      <div
        id={mountId}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
