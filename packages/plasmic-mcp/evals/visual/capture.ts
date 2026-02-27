/**
 * Visual capture module — screenshots Plasmic Studio after each eval task.
 *
 * Captures the full Studio editor view (tree panel + canvas + right panel)
 * at desktop (1280x800) and optionally mobile (375x812) viewports.
 * Screenshots feed into the LLM-as-Judge grader (P2.4) for quality scoring.
 *
 * Why full editor view instead of just the preview frame: the editor view
 * shows the component tree, selected element, and style panel — giving the
 * LLM judge much richer context about the task outcome than rendered output
 * alone.
 *
 * Why Playwright: Studio loads inside nested iframes that require a real
 * browser to render. Simple HTTP screenshot services can't handle the
 * iframe chain or the authenticated session.
 *
 * Component-level navigation (V10): When a componentUuid is provided,
 * the capture navigates directly to that component's arena in Studio
 * using ?arena_type=component&arena={uuid} query params. This shows the
 * specific component that was modified, not just the project overview.
 * The runner extracts the last componentUuid from the conversation
 * transcript, handling both tool input params and creation results (VE4).
 */

import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Browser, BrowserContext, Page } from "playwright";
import type { McpEvalClient } from "../harness/mcp-client.js";
import { authenticateStudio, type StudioAuthConfig } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESULTS_DIR = join(__dirname, "..", "results");

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000;
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
/** P12.3: Wall-clock cap per capture() call. Prevents unbounded hangs when
 *  multiple nested iframe waits each consume the full navigation timeout. */
const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000;

/**
 * Studio frame selectors — centralized so they can be updated in one place
 * when Plasmic changes its iframe structure. These mirror the selectors used
 * in platform/wab/playwright/utils/studio-utils.ts.
 */
const SELECTORS = {
  /** Outer iframe wrapping the Studio app */
  outerFrame: "iframe.studio-frame",
  /** Inner iframe containing the canvas editor */
  innerFrame: "iframe.__wab_studio-frame",
  /** Canvas container element inside the inner iframe */
  canvasContainer: ".canvas-editor__canvas-container",
  /** Rsbuild error overlay (dev builds) */
  errorOverlay: ".rsbuild-error-overlay",
} as const;

/**
 * Error message patterns that indicate a browser crash requiring relaunch.
 * Expanded beyond the initial 3 to cover common Playwright/Chromium crash modes.
 */
const CRASH_PATTERNS = [
  "Target closed",
  "Browser closed",
  "Protocol error",
  "Target page, context or browser has been closed",
  "Connection refused",
  "Session closed",
] as const;

export interface VisualCaptureConfig {
  /** Run ID for organizing screenshots into per-run directories */
  runId: string;
  /** Studio auth credentials */
  authConfig: StudioAuthConfig;
  /** Navigation timeout in ms (default: 60000) */
  navigationTimeout?: number;
}

export interface CaptureResult {
  /** Path to desktop screenshot, null if capture failed */
  desktopPath: string | null;
  /** Path to mobile screenshot, null if not applicable or failed */
  mobilePath: string | null;
  /** Error message if capture failed, null on success */
  error: string | null;
}

/**
 * Keywords in scenario IDs/descriptions that indicate mobile viewport
 * screenshots are needed. Desktop screenshots are always captured.
 */
const MOBILE_KEYWORDS = [
  "mobile",
  "responsive",
  "screen-variant",
  "breakpoint",
  "screen variant",
];

/**
 * Determine if a scenario needs mobile screenshots based on its
 * ID and description. Desktop screenshots are always captured;
 * mobile is only for responsive/mobile-variant scenarios.
 */
export function needsMobileCapture(
  scenarioId: string,
  scenarioDescription: string
): boolean {
  const text = `${scenarioId} ${scenarioDescription}`.toLowerCase();
  return MOBILE_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Manages the Playwright browser session for visual capture.
 *
 * Created once per eval run and reused across all scenarios. The browser
 * session is authenticated once at initialization, then screenshots are
 * taken by navigating to the Studio URL after each scenario completes.
 *
 * Edge case handling (from spec mcp-eval-visual-capture.md):
 * - VE1: Studio fails to load -> save visible screenshot, log error, continue
 * - VE2: Auth fails -> retry once, then disable visual for remaining tasks
 * - VE5: Studio not running -> skip visual with warning
 * - VE6: Browser crashes -> relaunch, re-auth, continue from next task
 */
export class VisualCapture {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private authFailed = false;
  private config: VisualCaptureConfig;
  private screenshotDir: string;

  constructor(config: VisualCaptureConfig) {
    this.config = config;
    this.screenshotDir = join(RESULTS_DIR, "screenshots", config.runId);
  }

  /**
   * Launch Chromium and authenticate with Plasmic Studio.
   *
   * Uses dynamic import of playwright so mock-tier runs (which never
   * create a VisualCapture instance) don't need playwright installed.
   */
  async initialize(): Promise<void> {
    let chromium: (typeof import("playwright"))["chromium"];
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch {
      throw new Error(
        "playwright is not installed. Install it with: " +
          "npm install -D playwright && npx playwright install chromium"
      );
    }

    this.browser = await chromium.launch({ headless: true });

    try {
      this.context = await authenticateStudio(
        this.browser,
        this.config.authConfig
      );
      // V17: Set action timeout to 10s so individual Playwright actions
      // (clicks, waits) fail fast instead of hanging for 30s defaults.
      this.context.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
      this.page = await this.context.newPage();
      await this.page.setViewportSize(DESKTOP_VIEWPORT);
      // V18: Start tracing so we can save it on capture failures for debugging.
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    } catch (err: any) {
      // Retry auth once before giving up (spec VE2)
      console.error(
        `[visual] Auth failed: ${err.message}. Retrying once...`
      );
      try {
        if (this.context) await this.context.close();
        this.context = await authenticateStudio(
          this.browser,
          this.config.authConfig
        );
        this.context.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
        this.page = await this.context.newPage();
        await this.page.setViewportSize(DESKTOP_VIEWPORT);
        await this.context.tracing.start({ screenshots: true, snapshots: true });
      } catch (retryErr: any) {
        console.error(
          `[visual] Auth retry failed: ${retryErr.message}. ` +
            "Visual capture disabled for this run."
        );
        this.authFailed = true;
      }
    }

    mkdirSync(this.screenshotDir, { recursive: true });
  }

  /** Whether visual capture is available (auth succeeded, browser alive) */
  isAvailable(): boolean {
    return !this.authFailed && this.page !== null && this.browser !== null;
  }

  /**
   * Get the current page with a defensive null check. All page access in
   * capture methods should go through this helper instead of using `this.page!`.
   */
  private requirePage(): Page {
    if (!this.page) {
      throw new Error(
        "Visual capture page not initialized. Call initialize() first."
      );
    }
    return this.page;
  }

  /**
   * Capture screenshots of Studio showing the result of a scenario.
   *
   * When componentUuid is provided (V10), navigates directly to that
   * component's arena using ?arena_type=component&arena={uuid} query
   * params. This shows the specific component modified by the task,
   * giving the LLM judge focused visual context. When multiple components
   * were modified (VE4), the runner passes the last one from the transcript.
   *
   * Falls back to the project overview URL when no componentUuid is
   * available (e.g., project-level operations or component creation
   * where the UUID couldn't be extracted).
   */
  async capture(
    scenarioId: string,
    scenarioDescription: string,
    mcpClient: McpEvalClient,
    componentUuid?: string
  ): Promise<CaptureResult> {
    if (!this.isAvailable()) {
      return {
        desktopPath: null,
        mobilePath: null,
        error: "Visual capture disabled (auth failed)",
      };
    }

    // P12.3: Wall-clock cap for the entire capture operation. Without this,
    // nested iframe waits can each consume the full navigation timeout,
    // causing the capture to hang for minutes.
    const captureTimeout = DEFAULT_CAPTURE_TIMEOUT_MS;
    try {
      return await Promise.race([
        this.captureInner(scenarioId, scenarioDescription, mcpClient, componentUuid),
        new Promise<CaptureResult>((_, reject) =>
          setTimeout(
            () => reject(new Error("Capture wall-clock timeout")),
            captureTimeout
          )
        ),
      ]);
    } catch (err: any) {
      // VE6: Browser crashes — relaunch, re-auth, continue from next scenario
      if (CRASH_PATTERNS.some((p) => err.message?.includes(p))) {
        console.error(
          `[visual] Browser crashed for ${scenarioId}. Relaunching...`
        );
        try {
          await this.relaunch();
          return {
            desktopPath: null,
            mobilePath: null,
            error: "Browser crashed, relaunched for next scenario",
          };
        } catch (relaunchErr: any) {
          this.authFailed = true;
          return {
            desktopPath: null,
            mobilePath: null,
            error: `Browser crash + relaunch failed: ${relaunchErr.message}`,
          };
        }
      }

      // Save trace for non-crash failures too (including wall-clock timeout)
      await this.saveTraceOnFailure(scenarioId);
      return {
        desktopPath: null,
        mobilePath: null,
        error: `Capture failed: ${err.message}`,
      };
    }
  }

  /** Inner capture logic, separated for P12.3 wall-clock timeout wrapping. */
  private async captureInner(
    scenarioId: string,
    scenarioDescription: string,
    mcpClient: McpEvalClient,
    componentUuid?: string
  ): Promise<CaptureResult> {
    const page = this.requirePage();

    // Build Studio URL. When a componentUuid is available, navigate
    // directly to that component's arena (V10). Otherwise fall back
    // to the project overview.
    const host = this.config.authConfig.host.replace(/\/$/, "");
    const projectId = mcpClient.getProjectId();
    let studioUrl = `${host}/projects/${projectId}`;
    if (componentUuid) {
      studioUrl += `?arena_type=component&arena=${encodeURIComponent(componentUuid)}`;
    }

    const timeout =
      this.config.navigationTimeout ?? DEFAULT_NAVIGATION_TIMEOUT_MS;

    // Navigate to Studio and wait for canvas to load
    await page.setViewportSize(DESKTOP_VIEWPORT);

    try {
      await page.goto(studioUrl, { timeout, waitUntil: "load" });
      await this.waitForStudioCanvas(timeout);
    } catch (navErr: any) {
      // VE1: Studio fails to load — save whatever is visible, flag as failed
      console.error(
        `[visual] Studio navigation failed for ${scenarioId}: ${navErr.message}`
      );
      // P12.8: Initialize desktopPath as null, only set after successful
      // screenshot write. Previously returned the path even when screenshot
      // threw, causing the LLM judge to read a nonexistent file.
      let desktopPath: string | null = null;
      const targetPath = join(
        this.screenshotDir,
        `${scenarioId}-desktop.png`
      );
      try {
        await page.screenshot({ path: targetPath, fullPage: false });
        desktopPath = targetPath;
      } catch {
        // Screenshot also failed — page might be blank
      }
      // V18: Save trace on failure for debugging, then restart tracing
      await this.saveTraceOnFailure(scenarioId);
      return {
        desktopPath,
        mobilePath: null,
        error: `Navigation failed: ${navErr.message}`,
      };
    }

    // Desktop screenshot (always captured)
    const desktopPath = join(
      this.screenshotDir,
      `${scenarioId}-desktop.png`
    );
    await page.screenshot({ path: desktopPath, fullPage: false });

    // Mobile screenshot (only for responsive scenarios)
    let mobilePath: string | null = null;
    if (needsMobileCapture(scenarioId, scenarioDescription)) {
      await page.setViewportSize(MOBILE_VIEWPORT);
      // Brief wait for Studio to reflow at new viewport size
      await page.waitForTimeout(1000);
      mobilePath = join(this.screenshotDir, `${scenarioId}-mobile.png`);
      await page.screenshot({ path: mobilePath, fullPage: false });
      // Reset to desktop viewport for next scenario
      await page.setViewportSize(DESKTOP_VIEWPORT);
    }

    // P12.6: Stop and restart tracing after each successful capture.
    // Without this, tracing runs continuously from initialize() and the
    // trace buffer grows unbounded for the entire eval run. Only the
    // failure path (saveTraceOnFailure) stopped tracing before this fix.
    await this.resetTracing();

    return { desktopPath, mobilePath, error: null };
  }

  /**
   * Wait for the Studio canvas to load via the nested iframe structure.
   *
   * Studio uses two levels of iframes:
   *   page -> iframe.studio-frame -> iframe.__wab_studio-frame
   *     -> .canvas-editor__canvas-container
   *
   * This mirrors the pattern in platform/wab/playwright/utils/studio-utils.ts
   * (waitForFrameToLoad + goToProject).
   */
  private async waitForStudioCanvas(timeout: number): Promise<void> {
    const page = this.requirePage();

    // Wait for outer iframe to appear
    await page.waitForSelector(SELECTORS.outerFrame, {
      timeout: Math.min(timeout, 40_000),
    });

    // Brief pause for iframe initialization
    await page.waitForTimeout(1000);

    // Dismiss rsbuild error overlay if present (dev builds show this on HMR errors).
    // Timeout increased to 2000ms to handle slower Studio loads (P6.4).
    try {
      const overlay = page.locator(SELECTORS.errorOverlay).first();
      if (await overlay.isVisible({ timeout: 2000 })) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    } catch {
      // Overlay not present — expected in normal operation
    }

    // Wait for canvas container inside nested iframes
    const studioFrame = page
      .frameLocator(SELECTORS.outerFrame)
      .frameLocator(SELECTORS.innerFrame);

    await studioFrame
      .locator(SELECTORS.canvasContainer)
      .waitFor({ timeout, state: "attached" });
  }

  /**
   * P12.6: Stop and discard the current trace, then restart for the next
   * scenario. Called after each successful capture to prevent unbounded
   * trace buffer growth.
   */
  private async resetTracing(): Promise<void> {
    if (!this.context) return;
    try {
      // Stop without saving (discard) — successful captures don't need traces
      await this.context.tracing.stop();
      // Restart for the next scenario
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    } catch {
      // Tracing reset failed — non-fatal, continue
    }
  }

  /**
   * Save Playwright trace on capture failure for debugging (V18).
   * Stops the current trace, saves it to a zip file alongside screenshots,
   * and restarts tracing for the next scenario. Trace files can be viewed
   * with `npx playwright show-trace <path>`.
   */
  private async saveTraceOnFailure(scenarioId: string): Promise<void> {
    if (!this.context) return;
    try {
      const tracePath = join(this.screenshotDir, `${scenarioId}-trace.zip`);
      await this.context.tracing.stop({ path: tracePath });
      console.error(`[visual] Trace saved: ${tracePath}`);
      // Restart tracing for subsequent scenarios
      await this.context.tracing.start({ screenshots: true, snapshots: true });
    } catch {
      // Tracing save failed — non-fatal, continue
    }
  }

  /**
   * Relaunch browser and re-authenticate after a crash (VE6).
   * Creates a fresh browser instance and new authenticated session.
   */
  private async relaunch(): Promise<void> {
    try {
      if (this.browser) await this.browser.close();
    } catch {
      // Browser already closed
    }

    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({ headless: true });
    this.context = await authenticateStudio(
      this.browser,
      this.config.authConfig
    );
    this.context.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT_MS);
    this.page = await this.context.newPage();
    await this.page.setViewportSize(DESKTOP_VIEWPORT);
    await this.context.tracing.start({ screenshots: true, snapshots: true });
  }

  /** Release browser resources */
  async close(): Promise<void> {
    try {
      if (this.context) await this.context.close();
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (this.browser) await this.browser.close();
    } catch {
      // Ignore cleanup errors
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
