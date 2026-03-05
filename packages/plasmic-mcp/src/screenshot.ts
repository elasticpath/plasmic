/**
 * Screenshot capture for the visual feedback loop.
 *
 * Two capture paths:
 * 1. **URL-based** (page components) — navigates to the dev host preview URL
 * 2. **Studio pipeline** (non-page components) — uses the headless canvas
 *    renderer to render the component via Plasmic's own canvas rendering
 *    pipeline inside a Playwright-managed iframe
 *
 * Uses Playwright (optional dependency). Dynamically imported so the rest
 * of the MCP server works without it installed.
 */

import type { StudioPipelineOptions } from "./headless-canvas.js";

export interface ScreenshotOptions {
  /** Full URL to screenshot */
  url: string;
  /** Viewport width (default 1280) */
  width?: number;
  /** Viewport height (default 800) */
  height?: number;
  /** Total timeout in ms for browser launch + navigation + capture (default 10000) */
  timeout?: number;
}

export interface ScreenshotResult {
  /** Base64-encoded PNG */
  data: string;
  /** Viewport width used */
  width: number;
  /** Viewport height used */
  height: number;
}

/**
 * Capture a screenshot of the given URL using headless Chromium.
 *
 * Dynamically imports Playwright so it remains an optional dependency —
 * the rest of the MCP server works without it. Throws a clear error if
 * Playwright is not installed or if the page fails to load within the
 * timeout window.
 */
export async function captureScreenshot(
  options: ScreenshotOptions
): Promise<ScreenshotResult> {
  const { url, width = 1280, height = 800, timeout = 10000 } = options;

  // Dynamic import — Playwright is optional; only needed for screenshots
  let chromium: (typeof import("playwright"))["chromium"];
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    throw new Error(
      "Playwright is required for screenshots. Install with: npm install playwright && npx playwright install chromium"
    );
  }

  // Allocate time: ~2s for browser launch, rest for navigation + render
  const launchTimeout = Math.min(timeout, 5000);
  const navTimeout = Math.max(timeout - 2000, 3000);

  const browser = await chromium.launch({
    headless: true,
    timeout: launchTimeout,
  });

  try {
    const context = await browser.newContext({
      viewport: { width, height },
    });
    const page = await context.newPage();

    await page.goto(url, {
      timeout: navTimeout,
      waitUntil: "networkidle",
    });

    const buffer = await page.screenshot({ type: "png", fullPage: false });

    return {
      data: buffer.toString("base64"),
      width,
      height,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Capture a screenshot of a non-page component using the Studio rendering pipeline.
 *
 * Delegates to `captureWithStudioPipeline` from `headless-canvas.ts`, which:
 * - Launches headless Chromium
 * - Injects the headless-renderer.js bundle (WAB rendering functions)
 * - Creates an iframe to the dev host
 * - Uses `renderTplNode` + `setPlasmicRootNode` to render the component
 * - Screenshots the iframe
 */
export async function captureComponentScreenshot(
  options: StudioPipelineOptions
): Promise<ScreenshotResult> {
  // Dynamic import to keep headless-canvas.ts optional (it pulls in Playwright)
  const { captureWithStudioPipeline } = await import("./headless-canvas.js");
  return captureWithStudioPipeline(options);
}
