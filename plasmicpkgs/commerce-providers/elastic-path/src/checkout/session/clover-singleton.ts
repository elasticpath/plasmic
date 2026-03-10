/**
 * Clover SDK singleton — lazy-loads the Clover card fields SDK via script tag.
 *
 * WHY: Clover's SDK allows only one set of payment fields per page. This module
 * manages a single Clover instance + elements factory that all field components
 * share. The SDK is loaded lazily on first use (not at page load).
 *
 * Ported from storefront's lib/clover-singleton.ts, made framework-agnostic
 * (no Next.js deps) and parameterized (SDK URL derived from environment prop).
 */
import type {
  CloverConstructor,
  CloverSdkInstance,
  CloverElementsInstance,
  CloverTokenResult,
} from "./adapters/clover-types";

// ---------------------------------------------------------------------------
// SDK URLs by environment
// ---------------------------------------------------------------------------

const SDK_URLS: Record<string, string> = {
  sandbox: "https://checkout.sandbox.dev.clover.com/sdk.js",
  production: "https://checkout.clover.com/sdk.js",
};

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let sdkLoadPromise: Promise<void> | null = null;
let cloverInstance: CloverSdkInstance | null = null;
let elementsInstance: CloverElementsInstance | null = null;

// ---------------------------------------------------------------------------
// SDK loader
// ---------------------------------------------------------------------------

function loadSdk(environment: string): Promise<void> {
  if (sdkLoadPromise) return sdkLoadPromise;

  const sdkUrl = SDK_URLS[environment] ?? SDK_URLS.sandbox;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cannot load Clover SDK on server"));
      return;
    }

    const win = window as any;
    if (win.Clover) {
      resolve();
      return;
    }

    const existing = document.querySelector(
      `script[src="${sdkUrl}"]`
    ) as HTMLScriptElement | null;

    if (existing) {
      if (win.Clover) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => {
        sdkLoadPromise = null;
        reject(new Error("Failed to load Clover SDK"));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkLoadPromise = null;
      reject(new Error("Failed to load Clover SDK"));
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getOrCreateCloverInstance(
  pakmsKey: string,
  options?: { merchantId?: string; environment?: string }
): Promise<{ clover: CloverSdkInstance; elements: CloverElementsInstance }> {
  if (cloverInstance && elementsInstance) {
    return { clover: cloverInstance, elements: elementsInstance };
  }

  const env = options?.environment ?? "sandbox";
  await loadSdk(env);

  const win = window as any;
  const CloverCtor = win.Clover as CloverConstructor | undefined;
  if (!CloverCtor) {
    throw new Error("Clover SDK failed to initialize");
  }

  const initOptions: { merchantId?: string } = {};
  if (options?.merchantId) {
    initOptions.merchantId = options.merchantId;
  }

  cloverInstance = new CloverCtor(pakmsKey, initOptions);
  elementsInstance = cloverInstance.elements();

  return { clover: cloverInstance, elements: elementsInstance };
}

export async function createToken(): Promise<CloverTokenResult> {
  if (!cloverInstance) {
    throw new Error("Clover instance not initialized");
  }
  return cloverInstance.createToken();
}

export function destroyCloverInstance(): void {
  cloverInstance = null;
  elementsInstance = null;
  sdkLoadPromise = null;
}
