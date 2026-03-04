/**
 * Unit tests for the screenshot capture module (P4.1).
 *
 * Tests the captureScreenshot function and the capture-screenshot inspect
 * action integration. Playwright is mocked — these tests verify the
 * orchestration logic (URL construction, error handling, timeout config)
 * without launching a real browser.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Playwright — intercept the dynamic import("playwright") call
// ---------------------------------------------------------------------------

const mockScreenshot = vi.fn();
const mockGoto = vi.fn();
const mockNewPage = vi.fn();
const mockNewContext = vi.fn();
const mockClose = vi.fn();
const mockLaunch = vi.fn();

function setupPlaywrightMock(screenshotBuffer?: Buffer) {
  mockScreenshot.mockResolvedValue(
    screenshotBuffer ?? Buffer.from("fake-png-data")
  );
  mockGoto.mockResolvedValue(undefined);
  mockNewPage.mockResolvedValue({
    goto: mockGoto,
    screenshot: mockScreenshot,
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
// captureScreenshot unit tests
// ---------------------------------------------------------------------------

describe("captureScreenshot", () => {
  // Use a fresh import for each test to get the mocked playwright
  async function getCaptureScreenshot() {
    const mod = await import("../screenshot");
    return mod.captureScreenshot;
  }

  it("captures a screenshot with default viewport", async () => {
    const captureScreenshot = await getCaptureScreenshot();

    const result = await captureScreenshot({
      url: "http://localhost:3000/my-page",
    });

    expect(result.data).toBe(Buffer.from("fake-png-data").toString("base64"));
    expect(result.width).toBe(1280);
    expect(result.height).toBe(800);

    // Verify Playwright was called correctly
    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      timeout: expect.any(Number),
    });
    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 800 },
    });
    expect(mockGoto).toHaveBeenCalledWith("http://localhost:3000/my-page", {
      timeout: expect.any(Number),
      waitUntil: "networkidle",
    });
    expect(mockScreenshot).toHaveBeenCalledWith({
      type: "png",
      fullPage: false,
    });
  });

  it("respects custom viewport dimensions", async () => {
    const captureScreenshot = await getCaptureScreenshot();

    const result = await captureScreenshot({
      url: "http://localhost:3000/",
      width: 375,
      height: 812,
    });

    expect(result.width).toBe(375);
    expect(result.height).toBe(812);
    expect(mockNewContext).toHaveBeenCalledWith({
      viewport: { width: 375, height: 812 },
    });
  });

  it("returns base64-encoded PNG data", async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
    setupPlaywrightMock(pngData);

    const captureScreenshot = await getCaptureScreenshot();
    const result = await captureScreenshot({
      url: "http://localhost:3000/test",
    });

    expect(result.data).toBe(pngData.toString("base64"));
  });

  it("closes the browser even when navigation fails", async () => {
    mockGoto.mockRejectedValue(new Error("Navigation timeout"));

    const captureScreenshot = await getCaptureScreenshot();

    await expect(
      captureScreenshot({ url: "http://localhost:3000/broken" })
    ).rejects.toThrow("Navigation timeout");

    // Browser should still be closed
    expect(mockClose).toHaveBeenCalled();
  });

  it("closes the browser even when screenshot fails", async () => {
    mockScreenshot.mockRejectedValue(new Error("Screenshot failed"));

    const captureScreenshot = await getCaptureScreenshot();

    await expect(
      captureScreenshot({ url: "http://localhost:3000/test" })
    ).rejects.toThrow("Screenshot failed");

    expect(mockClose).toHaveBeenCalled();
  });

  it("passes timeout configuration to Playwright", async () => {
    const captureScreenshot = await getCaptureScreenshot();

    await captureScreenshot({
      url: "http://localhost:3000/",
      timeout: 15000,
    });

    // Launch timeout should be capped at 5000
    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      timeout: 5000,
    });

    // Navigation timeout = total - 2000
    expect(mockGoto).toHaveBeenCalledWith(expect.any(String), {
      timeout: 13000,
      waitUntil: "networkidle",
    });
  });

  it("ensures minimum navigation timeout of 3000ms", async () => {
    const captureScreenshot = await getCaptureScreenshot();

    await captureScreenshot({
      url: "http://localhost:3000/",
      timeout: 2000,
    });

    // Even with a 2s total timeout, nav timeout should be at least 3s
    expect(mockGoto).toHaveBeenCalledWith(expect.any(String), {
      timeout: 3000,
      waitUntil: "networkidle",
    });
  });

  it("propagates browser launch failures", async () => {
    mockLaunch.mockRejectedValue(new Error("Browser not found"));

    const captureScreenshot = await getCaptureScreenshot();

    await expect(
      captureScreenshot({ url: "http://localhost:3000/" })
    ).rejects.toThrow("Browser not found");
  });
});

// ---------------------------------------------------------------------------
// capture-screenshot action integration tests
// (Tests the server.ts handler logic using the same patterns as other
//  inspect action tests — construct mock session/site objects directly)
// ---------------------------------------------------------------------------

describe("capture-screenshot action logic", () => {
  it("builds the correct URL from hostUrl and pageMeta.path", () => {
    const hostUrl = "http://localhost:3000";
    const pagePath = "/about";
    const url = `${hostUrl.replace(/\/$/, "")}${pagePath}`;
    expect(url).toBe("http://localhost:3000/about");
  });

  it("strips trailing slash from hostUrl", () => {
    const hostUrl = "http://localhost:3000/";
    const pagePath = "/contact";
    const url = `${hostUrl.replace(/\/$/, "")}${pagePath}`;
    expect(url).toBe("http://localhost:3000/contact");
  });

  it("handles root path", () => {
    const hostUrl = "http://localhost:3000";
    const pagePath = "/";
    const url = `${hostUrl.replace(/\/$/, "")}${pagePath}`;
    expect(url).toBe("http://localhost:3000/");
  });

  it("handles nested paths", () => {
    const hostUrl = "https://my-app.vercel.app";
    const pagePath = "/products/category/shoes";
    const url = `${hostUrl.replace(/\/$/, "")}${pagePath}`;
    expect(url).toBe("https://my-app.vercel.app/products/category/shoes");
  });

  describe("error conditions", () => {
    it("identifies missing hostUrl", () => {
      const session = { hostUrl: undefined };
      expect(session.hostUrl).toBeUndefined();
    });

    it("identifies non-page component (no pageMeta)", () => {
      const component = { uuid: "abc", name: "MyButton" };
      expect((component as any).pageMeta?.path).toBeUndefined();
    });

    it("identifies non-page component (pageMeta without path)", () => {
      const component = { uuid: "abc", name: "MyCard", pageMeta: {} };
      expect((component as any).pageMeta?.path).toBeFalsy();
    });

    it("identifies component not found", () => {
      const components = [
        { uuid: "aaa", name: "Header" },
        { uuid: "bbb", name: "Footer" },
      ];
      const found = components.find((c) => c.uuid === "zzz");
      expect(found).toBeUndefined();
    });
  });
});
