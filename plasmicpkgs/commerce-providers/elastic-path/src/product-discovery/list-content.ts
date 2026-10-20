import type React from "react";

/**
 * Which slot a product list shows. A failed read with no products shows the
 * error slot, or the children over sample data when `sampleOnError` is set.
 */
export function listContent(opts: {
  isLoading: boolean;
  productCount: number;
  error: unknown;
  sampleOnError?: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
  loadingContent: React.ReactNode;
  errorContent: React.ReactNode;
  emptyContent: React.ReactNode;
}): { content: React.ReactNode; showSample: boolean } {
  const failed = !!opts.error && opts.productCount === 0;
  const showSample = failed && !!opts.sampleOnError;
  const content =
    opts.isLoading && opts.productCount === 0
      ? opts.loadingContent
      : showSample
        ? opts.children
        : failed
          ? opts.errorContent
          : opts.isEmpty
            ? opts.emptyContent
            : opts.children;
  return { content, showSample };
}
