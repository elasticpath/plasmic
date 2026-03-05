/**
 * Headless Canvas Screenshot — Studio Pipeline
 *
 * Renders non-page Plasmic components by reusing the Studio's own canvas
 * rendering pipeline inside a headless Chromium browser (via Playwright).
 *
 * Architecture:
 * 1. Launch headless Chromium with a blank page
 * 2. Inject the headless-renderer.js esbuild bundle (WAB rendering functions)
 * 3. Create a child iframe pointing to the dev host with `#canvas=true`
 * 4. Poll until the iframe's `window.__Sub` (SubDeps) is available
 * 5. Call `renderTplNode` to produce a React element from the component's TplTree
 * 6. Pass the React element to `setPlasmicRootNode` in the iframe
 * 7. Screenshot the iframe
 *
 * This avoids modifying any upstream WAB files — the headless-renderer-entry.ts
 * bundle imports rendering functions and the iframe provides the React runtime.
 */

import path from "path";
import { fileURLToPath } from "url";
import type { ScreenshotResult } from "./screenshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** How long to wait for the iframe's __Sub to become available (ms) */
const SUB_POLL_TIMEOUT = 5000;
/** Polling interval for __Sub availability (ms) */
const SUB_POLL_INTERVAL = 100;
/** How long to wait for the iframe to load the dev host (ms) */
const IFRAME_LOAD_TIMEOUT = 8000;

export interface StudioPipelineOptions {
  /** The dev host URL (e.g. http://localhost:3000) */
  hostUrl: string;
  /** The serialized site bundle (JSON) */
  bundle: string;
  /** The project ID */
  projectId: string;
  /** The component name to render */
  componentName: string;
  /** Viewport width (default 1280) */
  width?: number;
  /** Viewport height (default 800) */
  height?: number;
  /** Total timeout in ms (default 15000) */
  timeout?: number;
}

/**
 * Capture a screenshot of a non-page component using the Studio rendering pipeline.
 *
 * Dynamically imports Playwright (optional dependency). The headless-renderer.js
 * bundle must exist at dist/headless-renderer.js (built by `node build.mjs`).
 */
export async function captureWithStudioPipeline(
  options: StudioPipelineOptions
): Promise<ScreenshotResult> {
  const {
    hostUrl,
    bundle,
    projectId,
    componentName,
    width = 1280,
    height = 800,
    timeout = 15000,
  } = options;

  // Dynamic import — Playwright is optional
  let chromium: (typeof import("playwright"))["chromium"];
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    throw new Error(
      "Playwright is required for screenshots. Install with: npm install playwright && npx playwright install chromium"
    );
  }

  // Locate the headless renderer bundle
  const rendererBundlePath = path.resolve(__dirname, "../dist/headless-renderer.js");

  const browser = await chromium.launch({
    headless: true,
    timeout: Math.min(timeout, 5000),
  });

  try {
    const context = await browser.newContext({
      viewport: { width, height },
    });
    const page = await context.newPage();

    // Step 1: Navigate to a blank page and inject the renderer bundle
    await page.goto("about:blank");
    await page.addScriptTag({ path: rendererBundlePath });

    // Step 2: Create an iframe pointing to the dev host with canvas=true
    const devHostUrl = hostUrl.replace(/\/$/, "");
    const iframeUrl = `${devHostUrl}#canvas=true`;

    await page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.id = "plasmic-canvas";
      iframe.style.cssText = "width:100%;height:100%;border:none;position:absolute;top:0;left:0;";
      iframe.src = url;
      document.body.style.margin = "0";
      document.body.appendChild(iframe);
    }, iframeUrl);

    // Step 3: Wait for the iframe to load (with 8s timeout)
    const iframeHandle = await page.waitForSelector("#plasmic-canvas", {
      timeout: IFRAME_LOAD_TIMEOUT,
    });
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
      throw new Error(
        `Dev host iframe failed to initialize at ${devHostUrl} — ensure the dev host is running.`
      );
    }

    // Step 4: Poll for window.__Sub availability in the iframe
    try {
      await frame.waitForFunction(
        () => !!(window as any).__Sub,
        { timeout: SUB_POLL_TIMEOUT, polling: SUB_POLL_INTERVAL }
      );
    } catch {
      throw new Error(
        `Dev host at ${devHostUrl} did not expose window.__Sub within ${SUB_POLL_TIMEOUT}ms. ` +
          `Ensure the dev host is running and has canvas support enabled.`
      );
    }

    // Step 5: Use the renderer bundle to render the component in the iframe
    // The orchestration happens in the parent page's context, which has access
    // to both __HeadlessRenderer (from the bundle) and the iframe's __Sub.
    const renderResult = await page.evaluate(
      ({ bundleJson, projId, compName }) => {
        const renderer = (window as any).__HeadlessRenderer;
        if (!renderer) {
          return { error: "Headless renderer bundle not loaded" };
        }

        const iframe = document.getElementById("plasmic-canvas") as HTMLIFrameElement;
        const iframeWindow = iframe?.contentWindow as any;
        if (!iframeWindow?.__Sub) {
          return { error: "iframe __Sub not available" };
        }

        try {
          // Deserialize the site bundle
          const bundler = new renderer.FastBundler();
          const bundleData = JSON.parse(bundleJson);
          const { site } = renderer.unbundleSite(bundler, projId, bundleData, []);

          // Find the target component
          const component = site.components.find(
            (c: any) => c.name === compName
          );
          if (!component) {
            return {
              error: `Component "${compName}" not found in project. Available: ${site.components.map((c: any) => c.name).join(", ")}`,
            };
          }

          // Create a minimal rendering context using iframe's SubDeps
          const ctx = renderer.makeRenderingCtx({
            sub: iframeWindow.__Sub,
            site,
            valKey: "headless-root",
          });

          // Render the component's TplTree to a React element
          const element = renderer.renderTplNode(component.tplTree, ctx);

          // Inject the rendered element into the iframe via setPlasmicRootNode
          iframeWindow.__Sub.setPlasmicRootNode(element);

          return { success: true };
        } catch (err: any) {
          return { error: `Render failed: ${err.message || String(err)}` };
        }
      },
      { bundleJson: bundle, projId: projectId, compName: componentName }
    );

    if (renderResult.error) {
      throw new Error(renderResult.error);
    }

    // Step 6: Wait briefly for React to finish rendering
    await page.waitForTimeout(500);

    // Step 7: Screenshot the iframe
    const iframeElement = await page.$("#plasmic-canvas");
    if (!iframeElement) {
      throw new Error("Canvas iframe element not found for screenshot");
    }

    const buffer = await iframeElement.screenshot({ type: "png" });

    return {
      data: buffer.toString("base64"),
      width,
      height,
    };
  } finally {
    await browser.close();
  }
}
