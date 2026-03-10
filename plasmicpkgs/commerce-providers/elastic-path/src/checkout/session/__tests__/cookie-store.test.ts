/**
 * A-10.1: CookieSessionStore tests
 *
 * Covers encrypt/decrypt round-trips, tamper detection, get/set/delete
 * cookie semantics, expiry enforcement, and the short-secret guard.
 */
import { encrypt, decrypt, CookieSessionStore } from "../cookie-store";
import type { CheckoutSession, SessionRequest } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    id: "sess-1",
    status: "open",
    cartId: "cart-abc",
    cartHash: "hash-abc",
    customerInfo: null,
    shippingAddress: null,
    billingAddress: null,
    selectedShippingRateId: null,
    availableShippingRates: [],
    totals: null,
    payment: {
      gateway: null,
      status: "idle",
      clientToken: null,
      gatewayMetadata: {},
      actionData: null,
    },
    order: null,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function makeReq(cookies: Record<string, string> = {}): SessionRequest {
  return { body: {}, headers: {}, cookies };
}

const VALID_SECRET = "a-sufficiently-long-secret-key-32chars!!";

// ---------------------------------------------------------------------------
// encrypt / decrypt
// ---------------------------------------------------------------------------

describe("encrypt / decrypt", () => {
  it("round-trips plaintext with a valid secret", () => {
    const plaintext = JSON.stringify({ hello: "world" });
    const ciphertext = encrypt(plaintext, VALID_SECRET);
    expect(ciphertext).not.toBe(plaintext);

    const result = decrypt(ciphertext, VALID_SECRET);
    expect(result).toBe(plaintext);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const plaintext = "same input";
    const ct1 = encrypt(plaintext, VALID_SECRET);
    const ct2 = encrypt(plaintext, VALID_SECRET);
    expect(ct1).not.toBe(ct2);
  });

  it("returns null for obviously invalid (empty) ciphertext", () => {
    expect(decrypt("", VALID_SECRET)).toBeNull();
  });

  it("returns null for truncated ciphertext (too short for IV+authTag)", () => {
    // A base64 string shorter than 28 bytes decoded cannot hold IV(12)+authTag(16)
    const tooShort = Buffer.alloc(20).toString("base64");
    expect(decrypt(tooShort, VALID_SECRET)).toBeNull();
  });

  it("returns null when secret is wrong (auth tag mismatch)", () => {
    const ciphertext = encrypt("secret data", VALID_SECRET);
    expect(decrypt(ciphertext, "a-completely-different-secret-key!!")).toBeNull();
  });

  it("returns null for arbitrary non-base64 garbage", () => {
    expect(decrypt("not base64 @@##!!", VALID_SECRET)).toBeNull();
  });

  it("returns null for valid base64 that is not a valid ciphertext", () => {
    const fakeCipher = Buffer.alloc(64, 0xff).toString("base64");
    expect(decrypt(fakeCipher, VALID_SECRET)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CookieSessionStore — constructor
// ---------------------------------------------------------------------------

describe("CookieSessionStore constructor", () => {
  it("throws when secret is empty", () => {
    expect(() => new CookieSessionStore("")).toThrow(
      "CHECKOUT_SESSION_SECRET must be at least 16 characters"
    );
  });

  it("throws when secret is shorter than 16 characters", () => {
    expect(() => new CookieSessionStore("short")).toThrow(
      "CHECKOUT_SESSION_SECRET must be at least 16 characters"
    );
  });

  it("throws at exactly 15 characters", () => {
    expect(() => new CookieSessionStore("123456789012345")).toThrow();
  });

  it("accepts a secret that is exactly 16 characters", () => {
    expect(() => new CookieSessionStore("1234567890123456")).not.toThrow();
  });

  it("accepts a long secret", () => {
    expect(() => new CookieSessionStore(VALID_SECRET)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CookieSessionStore — get()
// ---------------------------------------------------------------------------

describe("CookieSessionStore.get()", () => {
  let store: CookieSessionStore;

  beforeEach(() => {
    store = new CookieSessionStore(VALID_SECRET, {
      cookieName: "ep_cs",
      secure: false,
    });
  });

  it("returns null when the cookie is absent", async () => {
    const result = await store.get("current", makeReq());
    expect(result).toBeNull();
  });

  it("returns the session when the cookie holds a valid encrypted session", async () => {
    const session = makeSession();
    const setResult = await store.set("current", session, 1800, makeReq());
    const setCookieHeader = setResult.headers["Set-Cookie"];

    // Extract the raw cookie value from the Set-Cookie header
    // Format: ep_cs=<value>; Path=/; Max-Age=1800; ...
    const match = setCookieHeader.match(/^ep_cs=([^;]+)/);
    expect(match).toBeTruthy();
    const cookieValue = decodeURIComponent(match![1]);

    const req = makeReq({ ep_cs: cookieValue });
    const retrieved = await store.get("current", req);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
    expect(retrieved!.cartId).toBe(session.cartId);
    expect(retrieved!.status).toBe("open");
  });

  it("returns null when the session has already expired", async () => {
    const expired = makeSession({ expiresAt: Date.now() - 1 });
    const setResult = await store.set("current", expired, 1800, makeReq());
    const match = setResult.headers["Set-Cookie"].match(/^ep_cs=([^;]+)/);
    const cookieValue = decodeURIComponent(match![1]);

    const req = makeReq({ ep_cs: cookieValue });
    const result = await store.get("current", req);
    expect(result).toBeNull();
  });

  it("returns null when the cookie value is tampered / corrupt", async () => {
    const req = makeReq({ ep_cs: "completely-invalid-ciphertext!!" });
    const result = await store.get("current", req);
    expect(result).toBeNull();
  });

  it("returns null when the cookie value is valid base64 but wrong secret", async () => {
    const otherStore = new CookieSessionStore("another-secret-long-enough!!", {
      cookieName: "ep_cs",
    });
    const setResult = await otherStore.set(
      "current",
      makeSession(),
      1800,
      makeReq()
    );
    const match = setResult.headers["Set-Cookie"].match(/^ep_cs=([^;]+)/);
    const cookieValue = decodeURIComponent(match![1]);

    const req = makeReq({ ep_cs: cookieValue });
    const result = await store.get("current", req);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CookieSessionStore — set()
// ---------------------------------------------------------------------------

describe("CookieSessionStore.set()", () => {
  let store: CookieSessionStore;

  beforeEach(() => {
    store = new CookieSessionStore(VALID_SECRET, {
      cookieName: "ep_cs",
      secure: false,
    });
  });

  it("returns a Set-Cookie header", async () => {
    const result = await store.set("current", makeSession(), 1800, makeReq());
    expect(result.headers["Set-Cookie"]).toBeDefined();
    expect(typeof result.headers["Set-Cookie"]).toBe("string");
  });

  it("Set-Cookie header starts with the cookie name", async () => {
    const result = await store.set("current", makeSession(), 1800, makeReq());
    expect(result.headers["Set-Cookie"]).toMatch(/^ep_cs=/);
  });

  it("Set-Cookie header includes Max-Age equal to the TTL", async () => {
    const result = await store.set("current", makeSession(), 3600, makeReq());
    expect(result.headers["Set-Cookie"]).toContain("Max-Age=3600");
  });

  it("Set-Cookie header includes HttpOnly and SameSite=Lax", async () => {
    const result = await store.set("current", makeSession(), 1800, makeReq());
    const header = result.headers["Set-Cookie"];
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("Set-Cookie header includes Secure when secure option is true", async () => {
    const secureStore = new CookieSessionStore(VALID_SECRET, {
      cookieName: "ep_cs",
      secure: true,
    });
    const result = await secureStore.set("current", makeSession(), 1800, makeReq());
    expect(result.headers["Set-Cookie"]).toContain("Secure");
  });

  it("Set-Cookie header does NOT include Secure when secure is false", async () => {
    const result = await store.set("current", makeSession(), 1800, makeReq());
    expect(result.headers["Set-Cookie"]).not.toContain("Secure");
  });
});

// ---------------------------------------------------------------------------
// CookieSessionStore — delete()
// ---------------------------------------------------------------------------

describe("CookieSessionStore.delete()", () => {
  let store: CookieSessionStore;

  beforeEach(() => {
    store = new CookieSessionStore(VALID_SECRET, {
      cookieName: "ep_cs",
      secure: false,
    });
  });

  it("returns a Set-Cookie header", async () => {
    const result = await store.delete("current", makeReq());
    expect(result.headers["Set-Cookie"]).toBeDefined();
  });

  it("clear header sets Max-Age=0 to expire the cookie immediately", async () => {
    const result = await store.delete("current", makeReq());
    expect(result.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("clear header includes the correct cookie name", async () => {
    const result = await store.delete("current", makeReq());
    expect(result.headers["Set-Cookie"]).toMatch(/^ep_cs=/);
  });

  it("clear header includes HttpOnly", async () => {
    const result = await store.delete("current", makeReq());
    expect(result.headers["Set-Cookie"]).toContain("HttpOnly");
  });
});
