/**
 * Screenshot capture for the visual feedback loop (P4.1).
 *
 * Uses Playwright (optional dependency) to capture a page rendered by
 * the dev host. Only supports page components — non-page components
 * have no standard preview URL on the dev host.
 *
 * Why Playwright: The dev host renders full React applications with
 * CSS, fonts, and interactive elements. Static rendering approaches
 * can't capture the full visual fidelity. Playwright is already a
 * devDependency of plasmic-mcp (used for evals).
 */

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
