/**
 * Headless styling contract — single style injection for catalog-search.
 *
 * The catalog-search components ship behaviour, not appearance. The only CSS
 * they need is structural — e.g. `position: relative` on the EPSearchBox
 * wrapper so its absolute-positioned clear button anchors. We ship that CSS
 * via a `<style>` tag with `:where()` rules so every selector has zero
 * specificity, meaning any class supplied by the designer (Plasmic, a CSS
 * module, plain class) always wins.
 *
 * Components opt in by calling `useHeadlessStyling()` once. The injection is
 * idempotent — multiple components on the same page result in exactly one
 * style tag.
 */

import { useEffect } from "react";

const STYLE_TAG_MARKER = "data-ep-headless-styles";

const STYLE_BLOCK = `
:where([data-ep-search-box]) {
  position: relative;
}
:where([data-ep-catalog-search-provider]) {
  width: 100%;
  align-self: stretch;
}
:where([data-ep-current-refinements]) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:where([data-ep-autocomplete-root]) {
  position: relative;
  width: 100%;
}
/* Hide the browser-native clear cross that input[type=search] adds on
 * focus/hover. Designers wire their own clear control via the
 * "clear" ref-action and the slot. */
[data-ep-autocomplete-root] input[type="search"]::-webkit-search-cancel-button,
[data-ep-autocomplete-root] input[type="search"]::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
  display: none;
}
:where([data-ep-autocomplete-panel]) {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 4px;
  max-height: 60vh;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  padding: 4px 0;
}
/* Plasmic generates per-element classes with specificity (0,1,0) that
 * include browser-default ul styles (list-style, padding, margin). :where()
 * has (0,0,0) and loses, so anchor these resets to the data-attribute
 * directly — same (0,1,0) specificity as Plasmic's class but with
 * source-order precedence on our side. Designers who need to override can
 * still target the list with their own class plus a more-specific selector
 * (e.g. their parent class). */
ul[data-ep-autocomplete-list] {
  list-style: none;
  margin: 0;
  padding: 0;
}
[data-ep-autocomplete-list] > li {
  cursor: pointer;
  padding: 0;
  list-style: none;
}
[data-ep-autocomplete-list] > li:hover,
[data-ep-autocomplete-list] > li[aria-selected="true"] {
  background: #f5f5f5;
}
:where([data-ep-autocomplete-close]) {
  display: none;
  appearance: none;
  border: 0;
  background: transparent;
  padding: 8px 12px;
  cursor: pointer;
}
@media (max-width: 680px) {
  :where([data-ep-autocomplete-panel]) {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: none;
  }
  :where([data-ep-autocomplete-close]) {
    display: inline-flex;
  }
}
`;

let injected = false;

export function injectHeadlessStyles(): void {
  if (injected) return;
  if (typeof document === "undefined") return;

  if (document.head.querySelector(`style[${STYLE_TAG_MARKER}]`)) {
    injected = true;
    return;
  }

  const style = document.createElement("style");
  style.setAttribute(STYLE_TAG_MARKER, "");
  style.textContent = STYLE_BLOCK;
  document.head.appendChild(style);
  injected = true;
}

export function useHeadlessStyling(): void {
  useEffect(() => {
    injectHeadlessStyles();
  }, []);
}

export const __test__ = {
  reset(): void {
    injected = false;
    if (typeof document !== "undefined") {
      document.head
        .querySelectorAll(`style[${STYLE_TAG_MARKER}]`)
        .forEach((el) => el.remove());
    }
  },
  STYLE_BLOCK,
  STYLE_TAG_MARKER,
};
