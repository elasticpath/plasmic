/**
 * Unit tests for headless-canvas.ts — the Studio rendering pipeline
 * for capturing screenshots of non-page components.
 *
 * Playwright is fully mocked. These tests verify the orchestration logic:
 * - iframe creation with correct dev host URL
 * - __Sub polling and timeout handling
 * - renderer bundle injection
 * - renderTplNode + setPlasmicRootNode invocation
 * - error paths (missing __Sub, render failure, iframe load timeout)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Playwright — full browser/context/page/frame mock
// ---------------------------------------------------------------------------

const mockScreenshot = vi.fn();
const mockGoto = vi.fn();
const mockAddScriptTag = vi.fn();
const mockEvaluate = vi.fn();
const mockWaitForSelector = vi.fn();
const mockWaitForTimeout = vi.fn();
const mockQuerySelector = vi.fn();
const mockNewPage = vi.fn();
const mockNewContext = vi.fn();
const mockClose = vi.fn();
const mockLaunch = vi.fn();
const mockWaitForFunction = vi.fn();

/** Fake iframe content frame */
const mockFrame = {
  waitForFunction: mockWaitForFunction,
};

/** Fake element handle for the iframe */
const mockIframeHandle = {
  contentFrame: vi.fn(),
  screenshot: mockScreenshot,
};

function setupPlaywrightMock() {
  mockScreenshot.mockResolvedValue(Buffer.from("fake-png-data"));
  mockGoto.mockResolvedValue(undefined);
  mockAddScriptTag.mockResolvedValue(undefined);
  mockEvaluate.mockResolvedValue({ success: true });
  mockWaitForTimeout.mockResolvedValue(undefined);
  mockWaitForFunction.mockResolvedValue(undefined);
  mockIframeHandle.contentFrame.mockResolvedValue(mockFrame);
  mockWaitForSelector.mockResolvedValue(mockIframeHandle);
  mockQuerySelector.mockResolvedValue(mockIframeHandle);
  mockNewPage.mockResolvedValue({
    goto: mockGoto,
    addScriptTag: mockAddScriptTag,
    evaluate: mockEvaluate,
    waitForSelector: mockWaitForSelector,
    waitForTimeout: mockWaitForTimeout,
    $: mockQuerySelector,
  });
  mockNewContext.mockResolvedValue({
    newPage: mockNewPage,
  });
  mockClose.mockResolvedValue(undefined);
  mockLaunch.mockResolvedValue({
    newContext: mockNewContext,
    close: mockClose,
  });
}

vi.mock("playwright", () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  setupPlaywrightMock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("captureWithStudioPipeline", () => {
  async function getCaptureWithStudioPipeline() {
    const mod = await import("../headless-canvas");
    return mod.captureWithStudioPipeline;
  }

  const defaultOptions = {
    hostUrl: "http://localhost:3000",
    bundle: JSON.stringify({ map: {}, root: "0" }),
    projectId: "test-project-id",
    componentName: "MyComponent",
  };

  it("launches headless Chromium", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      timeout: expect.any(Number),
    });
  });

  it("creates a page with the requested viewport", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture({ ...defaultOptions, width: 375, height: 812 });

    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 375, height: 812 },
    });
  });

  it("navigates to about:blank and injects the renderer bundle", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    expect(mockGoto).toHaveBeenCalledWith("about:blank");
    expect(mockAddScriptTag).toHaveBeenCalledWith({
      path: expect.stringContaining("headless-renderer.js"),
    });
  });

  it("creates an iframe with the dev host URL and #canvas=true", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    // The evaluate call that creates the iframe
    const evaluateCalls = mockEvaluate.mock.calls;
    const iframeCreationCall = evaluateCalls.find(
      (call: unknown[]) => typeof call[1] === "string" && call[1].includes("localhost:3000")
    );
    expect(iframeCreationCall).toBeDefined();
    // The URL should include #canvas=true
    expect(iframeCreationCall![1]).toBe("http://localhost:3000#canvas=true");
  });

  it("strips trailing slash from hostUrl", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture({ ...defaultOptions, hostUrl: "http://localhost:3000/" });

    const evaluateCalls = mockEvaluate.mock.calls;
    const iframeCreationCall = evaluateCalls.find(
      (call: unknown[]) => typeof call[1] === "string" && call[1].includes("localhost:3000")
    );
    expect(iframeCreationCall![1]).toBe("http://localhost:3000#canvas=true");
  });

  it("waits for iframe to load with 8s timeout", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    expect(mockWaitForSelector).toHaveBeenCalledWith("#plasmic-canvas", {
      timeout: 8000,
    });
  });

  it("polls for __Sub with 5s timeout and 100ms interval", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    expect(mockWaitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 5000, polling: 100 }
    );
  });

  it("passes bundle, projectId, and componentName to page.evaluate", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);

    // The rendering evaluate call (second evaluate call)
    const renderCall = mockEvaluate.mock.calls.find(
      (call: unknown[]) => typeof call[1] === "object" && call[1] !== null && "bundleJson" in call[1]
    );
    expect(renderCall).toBeDefined();
    expect(renderCall![1]).toEqual({
      bundleJson: defaultOptions.bundle,
      projId: defaultOptions.projectId,
      compName: defaultOptions.componentName,
    });
  });

  it("returns base64 PNG screenshot data", async () => {
    const capture = await getCaptureWithStudioPipeline();
    const result = await capture(defaultOptions);

    expect(result.data).toBe(Buffer.from("fake-png-data").toString("base64"));
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);
  });

  it("closes the browser in all cases", async () => {
    const capture = await getCaptureWithStudioPipeline();
    await capture(defaultOptions);
    expect(mockClose).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  describe("error paths", () => {
    it("throws when iframe contentFrame is null", async () => {
      mockIframeHandle.contentFrame.mockResolvedValue(null);

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow(
        /Dev host iframe failed to initialize/
      );
      expect(mockClose).toHaveBeenCalled();
    });

    it("throws descriptive error when __Sub polling times out", async () => {
      mockWaitForFunction.mockRejectedValue(new Error("Timeout"));

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow(
        /did not expose window\.__Sub/
      );
      expect(mockClose).toHaveBeenCalled();
    });

    it("throws when page.evaluate returns an error", async () => {
      // First evaluate is iframe creation (succeeds), second is render
      mockEvaluate
        .mockResolvedValueOnce(undefined) // iframe creation
        .mockResolvedValueOnce({ error: "Component \"Missing\" not found in project." });

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow(
        /Component "Missing" not found/
      );
      expect(mockClose).toHaveBeenCalled();
    });

    it("throws when renderer bundle is not loaded", async () => {
      mockEvaluate
        .mockResolvedValueOnce(undefined) // iframe creation
        .mockResolvedValueOnce({ error: "Headless renderer bundle not loaded" });

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow(
        /Headless renderer bundle not loaded/
      );
    });

    it("closes browser when screenshot fails", async () => {
      mockQuerySelector.mockResolvedValue(null);

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow(
        /Canvas iframe element not found/
      );
      expect(mockClose).toHaveBeenCalled();
    });

    it("closes browser when browser launch fails", async () => {
      mockLaunch.mockRejectedValue(new Error("Browser not found"));

      const capture = await getCaptureWithStudioPipeline();
      await expect(capture(defaultOptions)).rejects.toThrow("Browser not found");
    });
  });
});
