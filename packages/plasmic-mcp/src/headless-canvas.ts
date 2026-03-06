/**
 * Headless canvas screenshot capture via Playwright.
 *
 * Navigates to the dev host's PlasmicCanvasHost page in headless Chromium,
 * converts the component's TreeNode representation to React elements using
 * the dev host's own React instance (window.__Sub), calls setPlasmicRootNode()
 * to render, and screenshots the result.
 *
 * This approach avoids bundling WAB's canvas-rendering.ts (which has deep
 * dependencies on ViewCtx, CanvasCtx, MobX, etc.) by using the tree-reader's
 * existing JSON output and reconstructing React elements in-browser from it.
 *
 * Code components registered in the dev host (via registerComponent) are
 * resolved from window.__PlasmicComponentRegistry and rendered with their
 * actual implementations. Unregistered Plasmic components fall back to a
 * <div> wrapper with their children.
 */

import type { TreeNode } from "./types.js";

// Re-export for tests
export type { TreeNode };

export interface CaptureScreenshotOptions {
  /** Dev host base URL, e.g. http://localhost:3021 */
  devHostUrl: string;
  /** Human-readable component name (for error messages) */
  componentName: string;
  /** Full component tree from readComponentTree() */
  tree: TreeNode;
  /** Viewport width in pixels (default: 1280) */
  width?: number;
  /** Viewport height in pixels (default: 800) */
  height?: number;
  /** Navigation timeout in ms (default: 8000) */
  timeout?: number;
}

export interface CaptureScreenshotResult {
  /** Base64-encoded PNG image data */
  imageData: string;
  /** Viewport width used */
  width: number;
  /** Viewport height used */
  height: number;
}

/**
 * Browser-side function serialized into page.evaluate().
 * Converts a TreeNode JSON tree to React elements using the dev host's React
 * and renders it via setPlasmicRootNode.
 *
 * Exported for unit testing — not called directly from Node.
 */
export function browserRenderTree(treeData: any): void {
  // Use globalThis for browser+Node compatibility (globalThis === window in browsers)
  const g = globalThis as any;
  const sub = g.__Sub;
  const React = sub.React;
  const setPlasmicRootNode =
    sub.setPlasmicRootNode || sub.hostUtils?.setPlasmicRootNode;
  const registry: any[] = g.__PlasmicComponentRegistry || [];

  function findRegisteredComponent(name: string): any {
    const entry = registry.find(
      (r: any) => r.meta?.name === name || r.meta?.importName === name
    );
    return entry?.component;
  }

  function treeToElement(node: any, key?: number | string): any {
    if (!node) return null;

    // Skip nodes marked as not rendered
    if (node.visibility === "notRendered") return null;

    // Pure text leaf
    if (typeof node === "string") return node;

    // Text node without children — render inside its tag or as plain text
    if (node.text && (!node.children || node.children.length === 0)) {
      if (node.tag) {
        const style: Record<string, any> = { ...(node.styles || {}) };
        if (node.visibility === "displayNone") style.display = "none";
        const props: Record<string, any> = { key, style };
        if (node.attrs) {
          for (const [k, v] of Object.entries(node.attrs as Record<string, any>)) {
            if (k !== "class" && k !== "className" && k !== "style") {
              props[k] = v;
            }
          }
        }
        return React.createElement(node.tag, props, node.text);
      }
      return node.text;
    }

    // Recursively convert children
    const children = (node.children || [])
      .map((child: any, i: number) => treeToElement(child, i))
      .filter((c: any) => c !== null);

    // Code component — try registered implementation
    if (node.type === "component" && node.componentName) {
      const Comp = findRegisteredComponent(node.componentName);
      if (Comp) {
        try {
          const props: Record<string, any> = { key, ...(node.attrs || {}) };
          return React.createElement(Comp, props, ...children);
        } catch {
          // Fall through to div fallback
        }
      }
      // Fallback: render children inside a div
      const style: Record<string, any> = { ...(node.styles || {}) };
      if (node.visibility === "displayNone") style.display = "none";
      return React.createElement(
        "div",
        { key, style, "data-plasmic-component": node.componentName },
        ...children
      );
    }

    // Slot — just render children
    if (node.type === "slot") {
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      return React.createElement(React.Fragment, { key }, ...children);
    }

    // HTML tag
    const tag = node.tag || "div";
    const style: Record<string, any> = { ...(node.styles || {}) };
    if (node.visibility === "displayNone") style.display = "none";

    const props: Record<string, any> = { key, style };

    // Forward HTML attributes (skip React-incompatible names)
    if (node.attrs) {
      for (const [k, v] of Object.entries(node.attrs as Record<string, any>)) {
        if (k !== "class" && k !== "className" && k !== "style") {
          props[k] = v;
        }
      }
    }

    if (node.text) {
      return React.createElement(tag, props, node.text, ...children);
    }

    return React.createElement(tag, props, ...children);
  }

  const element = treeToElement(treeData);
  if (element) {
    setPlasmicRootNode(
      React.createElement(
        "div",
        {
          style: { padding: "16px", background: "#ffffff", minHeight: "100vh" },
          id: "__plasmic-screenshot-root",
        },
        element
      )
    );
  }
}

/**
 * Capture a screenshot of a Plasmic component via headless Chromium.
 *
 * 1. Launches headless Chromium via Playwright
 * 2. Navigates to {devHostUrl}/plasmic-host#canvas=true
 * 3. Waits for window.__Sub (React + setPlasmicRootNode)
 * 4. Converts the TreeNode tree to React elements in-browser
 * 5. Calls setPlasmicRootNode() to render into the canvas host
 * 6. Screenshots the page and returns base64 PNG
 */
export async function captureScreenshot(
  opts: CaptureScreenshotOptions
): Promise<CaptureScreenshotResult> {
  // Dynamic import — playwright is a devDependency
  let chromium: any;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    throw new Error(
      "Playwright is required for screenshots. Install: npm i -D playwright && npx playwright install chromium"
    );
  }

  const timeout = opts.timeout ?? 8000;
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;

  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width, height },
    });

    // Navigate to the dev host canvas page
    const hostUrl = opts.devHostUrl.replace(/\/$/, "");
    const canvasUrl = `${hostUrl}/plasmic-host#canvas=true`;

    try {
      await page.goto(canvasUrl, {
        timeout,
        waitUntil: "domcontentloaded",
      });
    } catch {
      throw new Error(`Dev host unavailable at ${hostUrl}`);
    }

    // Poll for __Sub with React and setPlasmicRootNode
    try {
      await page.waitForFunction(
        () => {
          const sub = (window as any).__Sub;
          return (
            sub?.React &&
            (sub?.setPlasmicRootNode || sub?.hostUtils?.setPlasmicRootNode)
          );
        },
        { timeout: 5000, polling: 100 }
      );
    } catch {
      throw new Error(
        "Dev host loaded but __Sub not available. " +
          "Ensure the host renders <PlasmicCanvasHost /> and uses @plasmicapp/host."
      );
    }

    // Render the tree into the canvas
    try {
      await page.evaluate(browserRenderTree, opts.tree);
    } catch (err: any) {
      throw new Error(
        `Render failed for "${opts.componentName}": ${err.message || err}`
      );
    }

    // Let React flush and paint
    await page.waitForTimeout(500);

    // Capture screenshot
    const screenshotBuffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    return {
      imageData: screenshotBuffer.toString("base64"),
      width,
      height,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
