import type { StripeConstructor } from "@stripe/stripe-js";

const STRIPE_JS_URL = "https://js.stripe.com/v3";

let pending: Promise<StripeConstructor> | null = null;

/**
 * Adds Stripe.js to the page once, on the first call, and resolves to the
 * global `Stripe` constructor. A failed load clears itself so a later call
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
    const script = document.createElement("script");
    script.src = STRIPE_JS_URL;
    script.async = true;
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
    document.head.appendChild(script);
  });
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
