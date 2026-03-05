/**
 * Tests for use-stripe-payment utility functions.
 *
 * Why: validateStripePublishableKey guards against misconfigured Stripe keys
 * (a silent-failure bug that surfaces only at payment time). formatStripeError
 * maps opaque Stripe error codes to user-friendly messages — wrong mappings
 * confuse customers into abandoning checkout.
 */

import {
  validateStripePublishableKey,
  formatStripeError,
} from "../hooks/use-stripe-payment";

describe("validateStripePublishableKey", () => {
  it("returns true for valid test key", () => {
    expect(validateStripePublishableKey("pk_test_1234567890abcdefgh")).toBe(
      true
    );
  });

  it("returns true for valid live key", () => {
    expect(validateStripePublishableKey("pk_live_1234567890abcdefgh")).toBe(
      true
    );
  });

  it("returns false for secret key prefix", () => {
    expect(validateStripePublishableKey("sk_test_1234567890abcdefgh")).toBe(
      false
    );
  });

  it("returns false for key shorter than 20 chars", () => {
    expect(validateStripePublishableKey("pk_test_short")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validateStripePublishableKey("")).toBe(false);
  });

  it("returns false for random string", () => {
    expect(validateStripePublishableKey("not-a-stripe-key")).toBe(false);
  });
});

describe("formatStripeError", () => {
  it("returns user-friendly message for card_declined", () => {
    expect(formatStripeError({ code: "card_declined" })).toBe(
      "Your card was declined. Please try a different card."
    );
  });

  it("returns user-friendly message for expired_card", () => {
    expect(formatStripeError({ code: "expired_card" })).toBe(
      "Your card has expired. Please try a different card."
    );
  });

  it("returns user-friendly message for incorrect_cvc", () => {
    expect(formatStripeError({ code: "incorrect_cvc" })).toBe(
      "Your card's security code is incorrect."
    );
  });

  it("returns user-friendly message for insufficient_funds", () => {
    expect(formatStripeError({ code: "insufficient_funds" })).toBe(
      "Your card has insufficient funds."
    );
  });

  it("returns user-friendly message for invalid_number", () => {
    expect(formatStripeError({ code: "invalid_number" })).toBe(
      "Your card number is invalid."
    );
  });

  it("returns user-friendly message for processing_error", () => {
    expect(formatStripeError({ code: "processing_error" })).toBe(
      "An error occurred processing your card. Please try again."
    );
  });

  it("returns user-friendly message for rate_limit", () => {
    expect(formatStripeError({ code: "rate_limit" })).toBe(
      "Too many requests. Please try again in a moment."
    );
  });

  it("falls back to error.type when code is missing", () => {
    expect(formatStripeError({ type: "card_declined" })).toBe(
      "Your card was declined. Please try a different card."
    );
  });

  it("falls back to error.message for unknown codes", () => {
    expect(formatStripeError({ code: "unknown_code", message: "Custom error" })).toBe(
      "Custom error"
    );
  });

  it("returns generic message when no code or message", () => {
    expect(formatStripeError({})).toBe(
      "Payment processing failed. Please try again."
    );
  });

  it("returns generic message for null error", () => {
    expect(formatStripeError(null)).toBe("An unknown error occurred");
  });

  it("returns generic message for undefined error", () => {
    expect(formatStripeError(undefined)).toBe("An unknown error occurred");
  });

  it("handles invalid_expiry_month", () => {
    expect(formatStripeError({ code: "invalid_expiry_month" })).toBe(
      "Your card's expiration month is invalid."
    );
  });

  it("handles invalid_expiry_year", () => {
    expect(formatStripeError({ code: "invalid_expiry_year" })).toBe(
      "Your card's expiration year is invalid."
    );
  });

  it("handles invalid_cvc", () => {
    expect(formatStripeError({ code: "invalid_cvc" })).toBe(
      "Your card's security code is invalid."
    );
  });
});
