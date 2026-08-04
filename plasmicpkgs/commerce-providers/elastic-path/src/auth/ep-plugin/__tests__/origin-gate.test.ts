import { describe, expect, it } from "vitest";
import {
  enforceOriginGate,
  isTrustedOrigin,
  matchesOriginPattern,
  passesOriginGate,
} from "../origin-gate";

const TRUSTED = ["http://localhost:3456", "https://*.vercel.app"];

function req(
  method: string,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost:3456/api/ep/cart/items", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: "{}" }),
  });
}

describe("matchesOriginPattern", () => {
  it("matches an exact origin and rejects a near-miss", () => {
    expect(
      matchesOriginPattern("http://localhost:3456", "http://localhost:3456")
    ).toBe(true);
    expect(
      matchesOriginPattern("http://localhost:3457", "http://localhost:3456")
    ).toBe(false);
    expect(
      matchesOriginPattern("https://localhost:3456", "http://localhost:3456")
    ).toBe(false);
  });

  it("ignores path and trailing content when comparing origins", () => {
    expect(
      matchesOriginPattern(
        "http://localhost:3456/api/ep",
        "http://localhost:3456"
      )
    ).toBe(true);
  });

  it("honours full-origin wildcard patterns", () => {
    expect(
      matchesOriginPattern("https://preview.vercel.app", "https://*.vercel.app")
    ).toBe(true);
    expect(
      matchesOriginPattern("http://preview.vercel.app", "https://*.vercel.app")
    ).toBe(false);
    expect(
      matchesOriginPattern("https://vercel.app.evil.com", "https://*.vercel.app")
    ).toBe(false);
  });

  it("matches host-only wildcard patterns against the host", () => {
    expect(
      matchesOriginPattern("https://shop.elasticpath.com", "*.elasticpath.com")
    ).toBe(true);
    expect(
      matchesOriginPattern("https://elasticpath.com.evil.io", "*.elasticpath.com")
    ).toBe(false);
  });

  it("rejects opaque and unparseable origins", () => {
    expect(matchesOriginPattern("null", "http://localhost:3456")).toBe(false);
    expect(matchesOriginPattern("null", "https://*.vercel.app")).toBe(false);
    expect(matchesOriginPattern("", "http://localhost:3456")).toBe(false);
  });
});

describe("isTrustedOrigin", () => {
  it("is false when the trust list is empty or absent", () => {
    expect(isTrustedOrigin("http://localhost:3456", [])).toBe(false);
    expect(isTrustedOrigin("http://localhost:3456", undefined)).toBe(false);
  });

  it("accepts any matching entry in the list", () => {
    expect(isTrustedOrigin("https://x.vercel.app", TRUSTED)).toBe(true);
    expect(isTrustedOrigin("http://evil.test", TRUSTED)).toBe(false);
  });
});

describe("passesOriginGate", () => {
  it("passes safe methods regardless of origin", () => {
    expect(
      passesOriginGate(
        req("GET", { origin: "http://evil.test", "sec-fetch-site": "cross-site" }),
        TRUSTED
      )
    ).toBe(true);
    expect(passesOriginGate(req("HEAD"), TRUSTED)).toBe(true);
    expect(
      passesOriginGate(
        req("OPTIONS", { origin: "http://evil.test" }),
        TRUSTED
      )
    ).toBe(true);
  });

  it("passes unsafe methods reported as same-origin or browser-initiated", () => {
    expect(
      passesOriginGate(req("POST", { "sec-fetch-site": "same-origin" }), TRUSTED)
    ).toBe(true);
    expect(
      passesOriginGate(req("POST", { "sec-fetch-site": "none" }), TRUSTED)
    ).toBe(true);
  });

  it("passes cross-site requests from a trusted origin", () => {
    expect(
      passesOriginGate(
        req("POST", {
          "sec-fetch-site": "cross-site",
          origin: "https://preview.vercel.app",
        }),
        TRUSTED
      )
    ).toBe(true);
  });

  it("rejects cross-site requests from an untrusted origin", () => {
    expect(
      passesOriginGate(
        req("POST", {
          "sec-fetch-site": "cross-site",
          origin: "http://evil.test",
        }),
        TRUSTED
      )
    ).toBe(false);
    expect(
      passesOriginGate(
        req("DELETE", {
          "sec-fetch-site": "same-site",
          origin: "http://evil.test",
        }),
        TRUSTED
      )
    ).toBe(false);
  });

  it("rejects a cross-site request that withholds its Origin", () => {
    expect(
      passesOriginGate(req("POST", { "sec-fetch-site": "cross-site" }), TRUSTED)
    ).toBe(false);
  });

  it("passes non-browser clients that send neither signal", () => {
    expect(passesOriginGate(req("POST"), TRUSTED)).toBe(true);
  });

  it("passes a same-origin request whose own origin is absent from the trust list", () => {
    // Go's CrossOriginProtection compares Origin against the request's Host
    // before consulting any allowlist. An explicit `trustedOrigins` replaces
    // the defaults, so the deployment's own origin can legitimately be
    // missing from the list while the request is still same-origin.
    const studioOnly = ["https://studio.example.com"];
    expect(
      passesOriginGate(
        req("POST", { origin: "http://localhost:3456" }),
        studioOnly
      )
    ).toBe(true);
    expect(
      passesOriginGate(
        req("POST", {
          origin: "http://localhost:3456",
          "sec-fetch-site": "cross-site",
        }),
        studioOnly
      )
    ).toBe(true);
  });

  it("still rejects a different origin when the trust list omits it", () => {
    expect(
      passesOriginGate(
        req("POST", { origin: "http://localhost:9999" }),
        ["https://studio.example.com"]
      )
    ).toBe(false);
  });

  it("checks the Origin when Sec-Fetch-Site is absent", () => {
    expect(
      passesOriginGate(req("POST", { origin: "http://localhost:3456" }), TRUSTED)
    ).toBe(true);
    expect(
      passesOriginGate(req("POST", { origin: "http://evil.test" }), TRUSTED)
    ).toBe(false);
  });
});

describe("enforceOriginGate", () => {
  it("returns null when the request passes", () => {
    expect(enforceOriginGate(req("GET"), TRUSTED)).toBeNull();
  });

  it("returns a 403 untrusted_origin JSON response when it rejects", async () => {
    const res = enforceOriginGate(
      req("POST", { "sec-fetch-site": "cross-site", origin: "http://evil.test" }),
      TRUSTED
    );
    expect(res?.status).toBe(403);
    expect(res?.headers.get("Content-Type")).toBe("application/json");
    expect(await res!.json()).toEqual({ error: "untrusted_origin" });
  });
});
