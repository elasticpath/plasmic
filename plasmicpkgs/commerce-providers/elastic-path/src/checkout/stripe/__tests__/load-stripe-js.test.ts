/**
 * @jest-environment jsdom
 */

const STRIPE_JS = "https://js.stripe.com/v3";

function stripeScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script")).filter(
    (s) => s.src === STRIPE_JS
  );
}

function freshLoader(): { loadStripeJs: () => Promise<unknown> } {
  let mod: any;
  jest.isolateModules(() => {
    mod = require("../load-stripe-js");
  });
  return mod;
}

describe("loadStripeJs", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    delete (window as any).Stripe;
  });

  it("adds nothing to the page until it is called", () => {
    freshLoader();
    expect(stripeScripts()).toHaveLength(0);
  });

  it("adds one script from js.stripe.com however many times it is called", () => {
    const { loadStripeJs } = freshLoader();
    const first = loadStripeJs();
    const second = loadStripeJs();
    expect(stripeScripts()).toHaveLength(1);
    expect(second).toBe(first);
  });

  it("resolves to the global Stripe constructor once the script loads", async () => {
    const { loadStripeJs } = freshLoader();
    const pending = loadStripeJs();
    const Stripe = jest.fn();
    (window as any).Stripe = Stripe;
    stripeScripts()[0].dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(Stripe);
  });

  it("uses Stripe.js already on the page without adding a script", async () => {
    const Stripe = jest.fn();
    (window as any).Stripe = Stripe;
    const { loadStripeJs } = freshLoader();
    await expect(loadStripeJs()).resolves.toBe(Stripe);
    expect(stripeScripts()).toHaveLength(0);
  });

  it("rejects with a clear error when the script fails, and a later call retries", async () => {
    const { loadStripeJs } = freshLoader();
    const failed = loadStripeJs();
    stripeScripts()[0].dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow(
      "Failed to load Stripe.js from https://js.stripe.com/v3"
    );
    expect(stripeScripts()).toHaveLength(0);

    const retry = loadStripeJs();
    expect(stripeScripts()).toHaveLength(1);
    const Stripe = jest.fn();
    (window as any).Stripe = Stripe;
    stripeScripts()[0].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(Stripe);
  });

  it("rejects when the script loads without defining Stripe", async () => {
    const { loadStripeJs } = freshLoader();
    const pending = loadStripeJs();
    stripeScripts()[0].dispatchEvent(new Event("load"));
    await expect(pending).rejects.toThrow("Stripe.js did not define window.Stripe");
  });
});
