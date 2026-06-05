/**
 * pagination-window — the windowing math a designer can't express in a binding
 * (ADR-0011 D4). Turns InstantSearch's windowed `pages` array into a render-ready
 * list of page items with ellipsis sentinels and first/last/current flags, so a
 * numbered pager is a plain `dataRep` over `pageItems` instead of hand-assembled
 * conditional spans plus windowing arithmetic.
 *
 * Pure and side-effect free — exercised directly in tests. The raw
 * `pages: number[]` and `goTo` stay alongside it (additive).
 */

export interface SearchPageItem {
  /** A concrete page link, or an elided gap. */
  type: "page" | "ellipsis";
  /** 0-indexed page number (page items only). */
  page?: number;
  /** Display label — the 1-indexed page number, or "…" for an ellipsis. */
  label: string;
  isCurrent: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Navigate to this page (page items only); pre-bound, no argument. */
  goTo?: () => void;
}

/**
 * Build the windowed page-item list.
 *
 * @param pages   InstantSearch's windowed page array (already padded around the
 *                current page); falls back to `[currentPage]` when empty.
 * @param nbPages total page count.
 * @param currentPage 0-indexed current page.
 * @param goTo    navigation callback (0-indexed); each page item binds its own.
 */
export function buildPageItems(
  pages: number[],
  nbPages: number,
  currentPage: number,
  goTo: (page: number) => void
): SearchPageItem[] {
  if (nbPages <= 0) return [];

  const windowed = pages && pages.length > 0 ? pages : [currentPage];
  const items: SearchPageItem[] = [];

  const pageItem = (page: number): SearchPageItem => ({
    type: "page",
    page,
    label: String(page + 1),
    isCurrent: page === currentPage,
    isFirst: page === 0,
    isLast: page === nbPages - 1,
    goTo: () => goTo(page),
  });
  const ellipsis = (): SearchPageItem => ({
    type: "ellipsis",
    label: "…",
    isCurrent: false,
    isFirst: false,
    isLast: false,
  });

  const first = windowed[0];
  const last = windowed[windowed.length - 1];

  // Leading anchor to page 1 + a gap sentinel when the window doesn't reach it.
  if (first > 0) {
    items.push(pageItem(0));
    if (first > 1) items.push(ellipsis());
  }

  windowed.forEach((p) => items.push(pageItem(p)));

  // Trailing gap sentinel + anchor to the last page.
  if (last < nbPages - 1) {
    if (last < nbPages - 2) items.push(ellipsis());
    items.push(pageItem(nbPages - 1));
  }

  return items;
}
