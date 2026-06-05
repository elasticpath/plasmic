import { getPopoverPositionStyles } from "../popover-position";

describe("getPopoverPositionStyles", () => {
  it("anchors bottom-end below the trigger, aligned to its right edge", () => {
    expect(getPopoverPositionStyles("bottom-end", 8)).toEqual({
      position: "absolute",
      zIndex: 9999,
      top: "100%",
      marginTop: 8,
      right: 0,
    });
  });

  it("anchors bottom-start below the trigger, aligned to its left edge", () => {
    expect(getPopoverPositionStyles("bottom-start", 12)).toEqual({
      position: "absolute",
      zIndex: 9999,
      top: "100%",
      marginTop: 12,
      left: 0,
    });
  });

  it("anchors top-end above the trigger, aligned to its right edge", () => {
    expect(getPopoverPositionStyles("top-end", 4)).toEqual({
      position: "absolute",
      zIndex: 9999,
      bottom: "100%",
      marginBottom: 4,
      right: 0,
    });
  });

  it("anchors top-start above the trigger, aligned to its left edge", () => {
    expect(getPopoverPositionStyles("top-start", 0)).toEqual({
      position: "absolute",
      zIndex: 9999,
      bottom: "100%",
      marginBottom: 0,
      left: 0,
    });
  });
});
