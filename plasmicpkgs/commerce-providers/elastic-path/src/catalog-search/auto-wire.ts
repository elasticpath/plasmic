/**
 * auto-wire — the prop-getter pattern for repeated interactive items
 * (ADR-0011 D2).
 *
 * The autocomplete list already delivers zero-wiring interaction by spreading
 * `getItemProps()` (onClick + role + aria-*) onto each slotted `<li>`. This
 * generalises that idea to refinement and single-select facet items: the
 * component owns the click, the active/selected state, and the keyboard a11y;
 * the designer only styles the slot.
 *
 * Auto-wiring is a defaulted-on, disableable prop. With it OFF the components
 * inject nothing — byte-for-byte today's behaviour (the per-item `toggle`
 * stays on context as the Tier-1 escape for custom, multi-step interactions).
 *
 * Injection reuses `cloneWithInjectedHandlers` (Pattern C): it clones the
 * designer's slot element, composing any onClick/onKeyDown they set. Non-element
 * / multi-element slots fail open (returned unchanged) — `toggle` is the escape.
 */

import React from "react";
import { cloneWithInjectedHandlers } from "./cloneWithInjectedHandlers";

export interface ItemInteraction {
  /** Run on click / Enter / Space. */
  onActivate: () => void;
  /** ARIA role for the interactive slot element. */
  role: "button" | "radio";
  /** Selected/active state → drives the selection ARIA attribute + data-active. */
  selected?: boolean;
  /** Which ARIA selection attribute reflects `selected`. */
  selectionAttr?: "aria-pressed" | "aria-checked";
}

/** The behavioural props spread onto an interactive item. */
export function buildItemInteractionProps(
  opts: ItemInteraction
): Record<string, unknown> {
  const { onActivate, role, selected, selectionAttr } = opts;
  const props: Record<string, unknown> = {
    onClick: () => onActivate(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
    role,
    tabIndex: 0,
  };
  if (selectionAttr) props[selectionAttr] = !!selected;
  // Styling hook for the active state — designers target [data-active] in CSS
  // instead of branching the binding on isRefined.
  if (selected) props["data-active"] = "";
  return props;
}

/**
 * Clone a repeated slot item and inject the interaction props, composing the
 * designer's onClick/onKeyDown. Fail-open for non-element / multi-element
 * slots: the content is returned unchanged and the per-item `toggle` on context
 * remains the escape hatch.
 */
export function autoWireItem(
  content: React.ReactNode,
  opts: ItemInteraction
): React.ReactNode {
  return cloneWithInjectedHandlers(content, {
    injected: buildItemInteractionProps(opts),
    compose: ["onClick", "onKeyDown"],
  });
}
