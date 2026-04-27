/**
 * CookieSessionStore — encrypted httpOnly cookie persistence for CheckoutSession.
 *
 * Uses Node.js built-in crypto (AES-256-GCM) so there are no extra dependencies.
 * The cookie holds the full session JSON (~300-400 bytes encrypted). EP data is
 * kept minimal — just IDs and coordination state — so it fits in a single cookie.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";
import type {
  CheckoutSession,
  SessionStore,
  SessionRequest,
  SessionSetResult,
} from "./types";

const COOKIE_NAME = "ep_checkout_session";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function deriveKey(secret: string): Buffer {
  // SHA-256 the secret to always get exactly 32 bytes
  return createHash("sha256").update(secret).digest();
}

export function encrypt(data: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string, secret: string): string | null {
  try {
    const key = deriveKey(secret);
    const raw = Buffer.from(ciphertext, "base64");
    if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;

    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie header builders
// ---------------------------------------------------------------------------

export interface CookieStoreOptions {
  cookieName?: string;
  secure?: boolean;
  path?: string;
}

function buildSetCookieHeader(
  value: string,
  maxAge: number,
  opts: Required<CookieStoreOptions>
): string {
  const parts = [
    `${opts.cookieName}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookieHeader(opts: Required<CookieStoreOptions>): string {
  return `${opts.cookieName}=; Path=${opts.path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// CookieSessionStore
// ---------------------------------------------------------------------------

export class CookieSessionStore implements SessionStore {
  private secret: string;
  private opts: Required<CookieStoreOptions>;

  constructor(secret: string, opts?: CookieStoreOptions) {
    if (!secret || secret.length < 16) {
      throw new Error(
        "CHECKOUT_SESSION_SECRET must be at least 16 characters. " +
          "Set the CHECKOUT_SESSION_SECRET environment variable."
      );
    }
    this.secret = secret;
    this.opts = {
      cookieName: opts?.cookieName ?? COOKIE_NAME,
      secure: opts?.secure ?? process.env.NODE_ENV === "production",
      path: opts?.path ?? "/",
    };
  }

  async get(
    _id: string,
    req: SessionRequest
  ): Promise<CheckoutSession | null> {
    const raw = req.cookies[this.opts.cookieName];
    if (!raw) return null;

    const json = decrypt(raw, this.secret);
    if (!json) return null;

    try {
      const session: CheckoutSession = JSON.parse(json);
      // Check expiry server-side
      if (session.expiresAt && Date.now() > session.expiresAt) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  async set(
    _id: string,
    session: CheckoutSession,
    ttl: number,
    _req: SessionRequest
  ): Promise<SessionSetResult> {
    const json = JSON.stringify(session);
    const encrypted = encrypt(json, this.secret);
    const header = buildSetCookieHeader(encrypted, ttl, this.opts);
    return { headers: { "Set-Cookie": header } };
  }

  async delete(
    _id: string,
    _req: SessionRequest
  ): Promise<SessionSetResult> {
    const header = buildClearCookieHeader(this.opts);
    return { headers: { "Set-Cookie": header } };
  }
}
