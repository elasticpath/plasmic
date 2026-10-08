import type { StripeConstructor } from "@stripe/stripe-js";

const STRIPE_JS_URL = "https://js.stripe.com/v3";
const STRIPE_JS_URL_PATTERN = /^https:\/\/js\.stripe\.com\/v3\/?(\?.*)?$/;

let pending: Promise<StripeConstructor> | null = null;

function findStripeJsScript(): HTMLScriptElement | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    `script[src^="${STRIPE_JS_URL}"]`
  );
  return (
    Array.from(scripts).find((script) => STRIPE_JS_URL_PATTERN.test(script.src)) ??
    null
  );
}

/**
 * Adds Stripe.js to the page once, on the first call, and resolves to the
 * global `Stripe` constructor. A Stripe.js script already on the page is
 * waited for, not duplicated. A failed load clears itself so a later call
 * retries.
 */
export function loadStripeJs(): Promise<StripeConstructor> {
  if (pending) return pending;
  pending = new Promise<StripeConstructor>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Stripe.js can only load in the browser"));
      return;
    }
    if (window.Stripe) {
      resolve(window.Stripe);
      return;
    }
    const existing = findStripeJsScript();
    const script = existing ?? document.createElement("script");
    const fail = (error: Error) => {
      script.remove();
      reject(error);
    };
    script.addEventListener("load", () => {
      if (window.Stripe) resolve(window.Stripe);
      else fail(new Error("Stripe.js did not define window.Stripe"));
    });
    script.addEventListener("error", () =>
      fail(new Error(`Failed to load Stripe.js from ${STRIPE_JS_URL}`))
    );
    if (!existing) {
      script.src = STRIPE_JS_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
