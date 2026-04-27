/**
 * Clover 3DS SDK lazy-loader — loads clover3DS-sdk.js on demand.
 *
 * WHY: The 3DS SDK is separate from the main card fields SDK and should only
 * be loaded when a payment requires 3D Secure authentication (requires_action).
 * This avoids loading unnecessary scripts for cards that don't trigger 3DS.
 *
 * Ported from storefront's CartPayButton.tsx inline 3DS loader, with a 30-second
 * timeout on waitForExecutePatch (improvement over the reference which had no timeout).
 */
import type { Clover3DSUtil } from "./adapters/clover-types";

const CLOVER_3DS_SDK_URL =
  "https://checkout.clover.com/clover3DS/clover3DS-sdk.js";

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Singleton loader
// ---------------------------------------------------------------------------

let threeDsSdkPromise: Promise<void> | null = null;

export function loadClover3DSSDK(): Promise<void> {
  if (threeDsSdkPromise) return threeDsSdkPromise;

  threeDsSdkPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cannot load 3DS SDK on server"));
      return;
    }

    const win = window as any;
    if (win.clover3DSUtil) {
      resolve();
      return;
    }

    const existing = document.querySelector(
      `script[src="${CLOVER_3DS_SDK_URL}"]`
    ) as HTMLScriptElement | null;

    if (existing) {
      if (win.clover3DSUtil) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => {
        threeDsSdkPromise = null;
        reject(new Error("Failed to load Clover 3DS SDK"));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = CLOVER_3DS_SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      threeDsSdkPromise = null;
      reject(new Error("Failed to load Clover 3DS SDK"));
    };
    document.head.appendChild(script);
  });

  return threeDsSdkPromise;
}

// ---------------------------------------------------------------------------
// 3DS Util accessor
// ---------------------------------------------------------------------------

export function getClover3DSUtil(): Clover3DSUtil | null {
  if (typeof window === "undefined") return null;
  return (window as any).clover3DSUtil ?? null;
}

// ---------------------------------------------------------------------------
// executePatch event listener with timeout
// ---------------------------------------------------------------------------

export function waitForExecutePatch(
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("executePatch", handler);
      reject(new Error("Authentication timed out"));
    }, timeout);

    function handler(event: Event) {
      clearTimeout(timer);
      window.removeEventListener("executePatch", handler);
      const detail = (event as CustomEvent).detail;
      resolve(detail._3DSStatus as string);
    }

    window.addEventListener("executePatch", handler);
  });
}
