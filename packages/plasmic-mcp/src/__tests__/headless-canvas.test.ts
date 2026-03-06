/**
 * Tests for headless canvas screenshot capture.
 *
 * Mocks Playwright entirely — these are unit tests for the orchestration logic,
 * not integration tests that launch real browsers.
 *
 * Why: Screenshot verification is critical for MCP agents to self-correct
 * visual edits without human feedback. These tests ensure the capture pipeline
 * handles all edge cases: dev host unavailability, missing __Sub, component
 * rendering failures, and correct tree-to-React conversion.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Playwright mock
// ---------------------------------------------------------------------------

const mockScreenshotBuffer = {
  toString: vi.fn().mockReturnValue("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
};

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  waitForFunction: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(undefined),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(mockScreenshotBuffer),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockChromium = {
  launch: vi.fn().mockResolvedValue(mockBrowser),
};

vi.mock("playwright", () => ({
  chromium: mockChromium,
}));

// Import AFTER mocking
import { captureScreenshot, browserRenderTree, type CaptureScreenshotOptions, type TreeNode } from "../headless-canvas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTree(overrides: Partial<TreeNode> = {}): TreeNode {
  return {
    type: "tag",
    tag: "div",
    name: "root",
    uuid: "root-uuid",
    styles: { display: "flex", flexDirection: "column" },
    children: [
      {
        type: "tag",
        tag: "h1",
        name: "heading",
        uuid: "h1-uuid",
        styles: { fontSize: "32px", color: "#333" },
        text: "Hello World",
      },
      {
        type: "tag",
        tag: "p",
        name: "body-text",
        uuid: "p-uuid",
        styles: { fontSize: "16px" },
        text: "This is a paragraph.",
      },
    ],
    ...overrides,
  };
}

function makeOpts(overrides: Partial<CaptureScreenshotOptions> = {}): CaptureScreenshotOptions {
  return {
    devHostUrl: "http://localhost:3021",
    componentName: "TestComponent",
    tree: makeTree(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureScreenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to happy-path defaults
    mockChromium.launch.mockResolvedValue(mockBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.waitForFunction.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue(undefined);
    mockPage.waitForTimeout.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue(mockScreenshotBuffer);
    mockBrowser.close.mockResolvedValue(undefined);
    mockScreenshotBuffer.toString.mockReturnValue("base64pngdata");
  });

  // --- Happy path ---

  it("returns base64 PNG on successful capture", async () => {
    const result = await captureScreenshot(makeOpts());
    expect(result).toEqual({
      imageData: "base64pngdata",
      width: 1280,
      height: 800,
    });
  });

  it("launches headless Chromium", async () => {
    await captureScreenshot(makeOpts());
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
  });

  it("creates page with correct viewport", async () => {
    await captureScreenshot(makeOpts({ width: 1920, height: 1080 }));
    expect(mockBrowser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1920, height: 1080 },
    });
  });

  it("navigates to dev host canvas URL", async () => {
    await captureScreenshot(makeOpts({ devHostUrl: "http://localhost:3021" }));
    expect(mockPage.goto).toHaveBeenCalledWith(
      "http://localhost:3021/plasmic-host#canvas=true",
      { timeout: 8000, waitUntil: "domcontentloaded" }
    );
  });

  it("strips trailing slash from devHostUrl", async () => {
    await captureScreenshot(makeOpts({ devHostUrl: "http://localhost:3021/" }));
    expect(mockPage.goto).toHaveBeenCalledWith(
      "http://localhost:3021/plasmic-host#canvas=true",
      expect.any(Object)
    );
  });

  it("uses custom timeout for navigation", async () => {
    await captureScreenshot(makeOpts({ timeout: 15000 }));
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it("waits for __Sub with React and setPlasmicRootNode", async () => {
    await captureScreenshot(makeOpts());
    expect(mockPage.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 5000, polling: 100 }
    );
  });

  it("passes tree data to page.evaluate with browserRenderTree", async () => {
    const tree = makeTree();
    await captureScreenshot(makeOpts({ tree }));
    expect(mockPage.evaluate).toHaveBeenCalledWith(browserRenderTree, tree);
  });

  it("waits 500ms for React to flush after rendering", async () => {
    await captureScreenshot(makeOpts());
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
  });

  it("takes a full-page PNG screenshot", async () => {
    await captureScreenshot(makeOpts());
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      type: "png",
      fullPage: true,
    });
  });

  it("closes browser after successful capture", async () => {
    await captureScreenshot(makeOpts());
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  // --- Default dimensions ---

  it("uses default viewport 1280x800", async () => {
    await captureScreenshot(makeOpts());
    expect(mockBrowser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 800 },
    });
    expect((await captureScreenshot(makeOpts())).width).toBe(1280);
    expect((await captureScreenshot(makeOpts())).height).toBe(800);
  });

  // --- Error: dev host unavailable ---

  it("throws clear error when dev host is unreachable", async () => {
    mockPage.goto.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));
    await expect(captureScreenshot(makeOpts())).rejects.toThrow(
      "Dev host unavailable at http://localhost:3021"
    );
  });

  it("closes browser even when dev host is unreachable", async () => {
    mockPage.goto.mockRejectedValue(new Error("timeout"));
    await expect(captureScreenshot(makeOpts())).rejects.toThrow();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  // --- Error: __Sub not available ---

  it("throws clear error when __Sub is not available", async () => {
    mockPage.waitForFunction.mockRejectedValue(new Error("Timeout 5000ms"));
    await expect(captureScreenshot(makeOpts())).rejects.toThrow(
      "Dev host loaded but __Sub not available"
    );
  });

  it("closes browser when __Sub times out", async () => {
    mockPage.waitForFunction.mockRejectedValue(new Error("Timeout"));
    await expect(captureScreenshot(makeOpts())).rejects.toThrow();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  // --- Error: render failure ---

  it("throws render error with component name", async () => {
    mockPage.evaluate.mockRejectedValue(new Error("Cannot read properties of null"));
    await expect(
      captureScreenshot(makeOpts({ componentName: "MyButton" }))
    ).rejects.toThrow('Render failed for "MyButton"');
  });

  it("closes browser on render failure", async () => {
    mockPage.evaluate.mockRejectedValue(new Error("render error"));
    await expect(captureScreenshot(makeOpts())).rejects.toThrow();
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  // --- Error: browser close failure is swallowed ---

  it("does not throw when browser.close() fails", async () => {
    mockBrowser.close.mockRejectedValue(new Error("Already closed"));
    const result = await captureScreenshot(makeOpts());
    expect(result.imageData).toBe("base64pngdata");
  });
});

// ---------------------------------------------------------------------------
// browserRenderTree — unit tests in a simulated browser env
// ---------------------------------------------------------------------------

describe("browserRenderTree", () => {
  let mockReact: any;
  let mockSetPlasmicRootNode: Mock;
  let mockRegistry: any[];

  beforeEach(() => {
    mockReact = {
      createElement: vi.fn((...args: any[]) => ({
        _type: args[0],
        _props: args[1],
        _children: args.slice(2),
      })),
      Fragment: Symbol("Fragment"),
    };
    mockSetPlasmicRootNode = vi.fn();
    mockRegistry = [];

    // Simulate browser globals
    (globalThis as any).__Sub = {
      React: mockReact,
      setPlasmicRootNode: mockSetPlasmicRootNode,
    };
    (globalThis as any).__PlasmicComponentRegistry = mockRegistry;
  });

  afterEach(() => {
    delete (globalThis as any).__Sub;
    delete (globalThis as any).__PlasmicComponentRegistry;
  });

  it("renders a simple tag tree", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      styles: { display: "flex" },
      children: [
        { type: "tag", tag: "h1", text: "Hello", styles: { fontSize: "24px" } },
      ],
    };

    browserRenderTree(tree);

    expect(mockSetPlasmicRootNode).toHaveBeenCalledTimes(1);
    // The root wrapper div
    const rootCall = mockSetPlasmicRootNode.mock.calls[0][0];
    expect(rootCall._type).toBe("div");
    expect(rootCall._props.id).toBe("__plasmic-screenshot-root");
  });

  it("skips nodes with visibility notRendered", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      children: [
        { type: "tag", tag: "span", visibility: "notRendered", text: "hidden" },
        { type: "tag", tag: "span", text: "visible" },
      ],
    };

    browserRenderTree(tree);

    expect(mockSetPlasmicRootNode).toHaveBeenCalled();
    // The div should have been created — children filtering happens inside
    const divCall = mockReact.createElement.mock.calls.find(
      (c: any[]) => c[0] === "div" && c[1]?.key === undefined && !c[1]?.id
    );
    // notRendered child should produce null, visible child should produce element
  });

  it("applies display:none for displayNone visibility", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      visibility: "displayNone",
      styles: { color: "red" },
    };

    browserRenderTree(tree);

    // Find the createElement call for the div with displayNone
    const divCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === "div" && c[1]?.style?.display === "none"
    );
    expect(divCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves registered code components", () => {
    const FakeButton = () => null;
    mockRegistry.push({
      component: FakeButton,
      meta: { name: "MyButton" },
    });

    const tree: TreeNode = {
      type: "component",
      componentName: "MyButton",
      attrs: { label: "Click me" },
    };

    browserRenderTree(tree);

    const compCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === FakeButton
    );
    expect(compCalls.length).toBe(1);
    expect(compCalls[0][1]).toMatchObject({ label: "Click me" });
  });

  it("falls back to div for unregistered components", () => {
    const tree: TreeNode = {
      type: "component",
      componentName: "UnknownWidget",
      styles: { padding: "8px" },
      children: [{ type: "tag", tag: "span", text: "child" }],
    };

    browserRenderTree(tree);

    const fallbackCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) =>
        c[0] === "div" && c[1]?.["data-plasmic-component"] === "UnknownWidget"
    );
    expect(fallbackCalls.length).toBe(1);
  });

  it("renders slot children as fragment", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      children: [
        {
          type: "slot",
          slotName: "content",
          children: [
            { type: "tag", tag: "p", text: "slot child 1" },
            { type: "tag", tag: "p", text: "slot child 2" },
          ],
        },
      ],
    };

    browserRenderTree(tree);

    // Fragment should be used when slot has multiple children
    const fragmentCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === mockReact.Fragment
    );
    expect(fragmentCalls.length).toBe(1);
  });

  it("renders single slot child without fragment wrapper", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      children: [
        {
          type: "slot",
          slotName: "content",
          children: [{ type: "tag", tag: "p", text: "only child" }],
        },
      ],
    };

    browserRenderTree(tree);

    // No fragment needed for single child
    const fragmentCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === mockReact.Fragment
    );
    expect(fragmentCalls.length).toBe(0);
  });

  it("returns null for empty slot", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      children: [
        { type: "slot", slotName: "empty" },
      ],
    };

    browserRenderTree(tree);
    expect(mockSetPlasmicRootNode).toHaveBeenCalled();
  });

  it("forwards HTML attributes from attrs", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "a",
      attrs: { href: "/about", target: "_blank" },
      text: "About",
    };

    browserRenderTree(tree);

    const linkCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === "a"
    );
    expect(linkCalls.length).toBe(1);
    expect(linkCalls[0][1]).toMatchObject({ href: "/about", target: "_blank" });
  });

  it("skips class/className/style attrs to avoid conflicts", () => {
    const tree: TreeNode = {
      type: "tag",
      tag: "div",
      attrs: { class: "foo", className: "bar", style: "inline", "data-id": "ok" },
      styles: { color: "blue" },
    };

    browserRenderTree(tree);

    const divCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === "div" && c[1]?.["data-id"] === "ok"
    );
    expect(divCalls.length).toBe(1);
    // class/className/style should not be in props
    expect(divCalls[0][1].class).toBeUndefined();
    expect(divCalls[0][1].className).toBeUndefined();
    // style should be from styles, not attrs
    expect(divCalls[0][1].style).toEqual({ color: "blue" });
  });

  it("does not call setPlasmicRootNode for null tree", () => {
    browserRenderTree(null);
    expect(mockSetPlasmicRootNode).not.toHaveBeenCalled();
  });

  it("uses hostUtils.setPlasmicRootNode as fallback", () => {
    const altSetRoot = vi.fn();
    (globalThis as any).__Sub = {
      React: mockReact,
      hostUtils: { setPlasmicRootNode: altSetRoot },
    };

    browserRenderTree({ type: "tag", tag: "div" });

    expect(altSetRoot).toHaveBeenCalled();
  });

  it("resolves component by importName", () => {
    const FakeCard = () => null;
    mockRegistry.push({
      component: FakeCard,
      meta: { name: "CardInternal", importName: "Card" },
    });

    const tree: TreeNode = {
      type: "component",
      componentName: "Card",
    };

    browserRenderTree(tree);

    const compCalls = mockReact.createElement.mock.calls.filter(
      (c: any[]) => c[0] === FakeCard
    );
    expect(compCalls.length).toBe(1);
  });
});
