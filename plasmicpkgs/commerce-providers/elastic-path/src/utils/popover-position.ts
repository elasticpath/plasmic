import type { CSSProperties } from "react";
import { CART_OVERLAY_Z_INDEX } from "../const";

/** Where the popover panel anchors relative to its trigger. */
export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "top-start";

/**
 * Computes the absolute-positioning styles for a popover panel anchored to its
 * trigger within a `position: relative` wrapper.
 *
 * Pure: takes a placement and a pixel offset and returns the CSS edges + gap.
 * `bottom-*` placements drop the panel below the trigger (gap via `marginTop`);
 * `top-*` placements raise it above (gap via `marginBottom`). `*-start` aligns
 * the panel's left edge to the trigger; `*-end` aligns the right edge.
 */
export function getPopoverPositionStyles(
  placement: PopoverPlacement,
  offset: number
): CSSProperties {
  const [vertical, horizontal] = placement.split("-") as [
    "bottom" | "top",
    "start" | "end"
  ];

  const base: CSSProperties = {
    position: "absolute",
    zIndex: CART_OVERLAY_Z_INDEX,
  };

  if (vertical === "bottom") {
    base.top = "100%";
    base.marginTop = offset;
  } else {
    base.bottom = "100%";
    base.marginBottom = offset;
  }

  if (horizontal === "start") {
    base.left = 0;
  } else {
    base.right = 0;
  }

  return base;
}
