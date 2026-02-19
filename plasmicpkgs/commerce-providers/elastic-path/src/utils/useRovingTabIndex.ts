import { useCallback, useRef } from "react";

interface UseRovingTabIndexOptions {
  itemSelector?: string;
  orientation?: "horizontal" | "vertical" | "both";
}

export function useRovingTabIndex(options: UseRovingTabIndexOptions = {}) {
  const {
    itemSelector = '[role="radio"]:not([aria-disabled="true"])',
    orientation = "vertical",
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(itemSelector)
      );
      if (items.length === 0) return;

      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      if (currentIndex === -1) return;

      const prevKeys =
        orientation === "horizontal"
          ? ["ArrowLeft"]
          : orientation === "vertical"
          ? ["ArrowUp"]
          : ["ArrowLeft", "ArrowUp"];

      const nextKeys =
        orientation === "horizontal"
          ? ["ArrowRight"]
          : orientation === "vertical"
          ? ["ArrowDown"]
          : ["ArrowRight", "ArrowDown"];

      let nextIndex: number | null = null;

      if (prevKeys.includes(e.key)) {
        nextIndex = currentIndex === 0 ? items.length - 1 : currentIndex - 1;
      } else if (nextKeys.includes(e.key)) {
        nextIndex = currentIndex === items.length - 1 ? 0 : currentIndex + 1;
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = items.length - 1;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        items[nextIndex].focus();
      }
    },
    [itemSelector, orientation]
  );

  return { containerRef, onKeyDown };
}
