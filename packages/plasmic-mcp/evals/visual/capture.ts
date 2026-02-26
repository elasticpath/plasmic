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
      this.page = await this.context.newPage();
      await this.page.setViewportSize(DESKTOP_VIEWPORT);
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
        this.page = await this.context.newPage();
        await this.page.setViewportSize(DESKTOP_VIEWPORT);
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
   * Capture screenshots of Studio showing the result of a scenario.
   *
   * Constructs the Studio URL from the auth host and project ID, navigates
   * there, waits for the canvas to load, and takes desktop (always) and
   * mobile (for responsive scenarios) screenshots.
   */
  async capture(
    scenarioId: string,
    scenarioDescription: string,
    mcpClient: McpEvalClient
  ): Promise<CaptureResult> {
    if (!this.isAvailable()) {
      return {
        desktopPath: null,
        mobilePath: null,
        error: "Visual capture disabled (auth failed)",
      };
    }

    try {
      // Build Studio URL from auth host + project ID.
      // This opens the project's default view in Studio. We don't use
      // inspect.preview-url because it requires a componentUuid — the
      // project-level URL is sufficient for capturing the editor state.
      const host = this.config.authConfig.host.replace(/\/$/, "");
      const projectId = mcpClient.getProjectId();
      const studioUrl = `${host}/projects/${projectId}`;

      const timeout =
        this.config.navigationTimeout ?? DEFAULT_NAVIGATION_TIMEOUT_MS;

      // Navigate to Studio and wait for canvas to load
      await this.page!.setViewportSize(DESKTOP_VIEWPORT);

      try {
        await this.page!.goto(studioUrl, { timeout, waitUntil: "load" });
        await this.waitForStudioCanvas(timeout);
      } catch (navErr: any) {
        // VE1: Studio fails to load — save whatever is visible, flag as failed
        console.error(
          `[visual] Studio navigation failed for ${scenarioId}: ${navErr.message}`
        );
        const desktopPath = join(
          this.screenshotDir,
          `${scenarioId}-desktop.png`
        );
        try {
          await this.page!.screenshot({ path: desktopPath, fullPage: false });
        } catch {
          // Screenshot also failed — page might be blank
        }
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
      await this.page!.screenshot({ path: desktopPath, fullPage: false });

      // Mobile screenshot (only for responsive scenarios)
      let mobilePath: string | null = null;
      if (needsMobileCapture(scenarioId, scenarioDescription)) {
        await this.page!.setViewportSize(MOBILE_VIEWPORT);
        // Brief wait for Studio to reflow at new viewport size
        await this.page!.waitForTimeout(1000);
        mobilePath = join(this.screenshotDir, `${scenarioId}-mobile.png`);
        await this.page!.screenshot({ path: mobilePath, fullPage: false });
        // Reset to desktop viewport for next scenario
        await this.page!.setViewportSize(DESKTOP_VIEWPORT);
      }

      return { desktopPath, mobilePath, error: null };
    } catch (err: any) {
      // VE6: Browser crashes — relaunch, re-auth, continue from next scenario
      if (
        err.message.includes("Target closed") ||
        err.message.includes("Browser closed") ||
        err.message.includes("Protocol error")
      ) {
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

      return {
        desktopPath: null,
        mobilePath: null,
        error: `Capture failed: ${err.message}`,
      };
    }
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
    // Wait for outer iframe to appear
    await this.page!.waitForSelector("iframe.studio-frame", {
      timeout: Math.min(timeout, 40_000),
    });

    // Brief pause for iframe initialization
    await this.page!.waitForTimeout(1000);

    // Dismiss rsbuild error overlay if present (dev builds show this on HMR errors)
    try {
      const overlay = this.page!.locator(".rsbuild-error-overlay").first();
      if (await overlay.isVisible({ timeout: 500 })) {
        await this.page!.keyboard.press("Escape");
        await this.page!.waitForTimeout(500);
      }
    } catch {
      // Overlay not present — expected in normal operation
    }

    // Wait for canvas container inside nested iframes
    const studioFrame = this.page!
      .frameLocator("iframe.studio-frame")
      .frameLocator("iframe.__wab_studio-frame");

    await studioFrame
      .locator(".canvas-editor__canvas-container")
      .waitFor({ timeout, state: "attached" });
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
    this.page = await this.context.newPage();
    await this.page.setViewportSize(DESKTOP_VIEWPORT);
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
