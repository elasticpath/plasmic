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
