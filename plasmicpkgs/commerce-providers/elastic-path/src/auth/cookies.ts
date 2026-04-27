export interface EpTokenData {
  accessToken: string;
  expires: number;
  expiresIn: number;
  tokenType: string;
  clientId: string;
  host: string;
}

export function parseEpTokenCookie(value: string): EpTokenData | null {
  try {
    const json = Buffer.from(value, "base64").toString("utf-8");
    const data = JSON.parse(json);
    if (
      typeof data.accessToken !== "string" ||
      typeof data.expires !== "number" ||
      typeof data.clientId !== "string" ||
      typeof data.host !== "string"
    ) {
      return null;
    }
    return data as EpTokenData;
  } catch {
    return null;
  }
}

export function buildEpTokenCookieHeader(
  data: EpTokenData,
  opts?: { secure?: boolean }
): string {
  const value = Buffer.from(JSON.stringify(data)).toString("base64");
  const parts = [
    `ep_token=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=2592000",
  ];
  if (opts?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function isTokenExpired(data: EpTokenData): boolean {
  return data.expires <= Math.floor(Date.now() / 1000);
}

// --- Account cookie ---

export interface EpAccountData {
  accountId: string;
  accountName: string;
  accountMemberId: string;
  token: string;
  expires: number;
}

export function parseEpAccountCookie(value: string): EpAccountData | null {
  try {
    const json = Buffer.from(value, "base64").toString("utf-8");
    const data = JSON.parse(json);
    if (
      typeof data.accountId !== "string" ||
      typeof data.accountName !== "string" ||
      typeof data.accountMemberId !== "string" ||
      typeof data.token !== "string" ||
      typeof data.expires !== "number"
    ) {
      return null;
    }
    return data as EpAccountData;
  } catch {
    return null;
  }
}

export function buildEpAccountCookieHeader(
  data: EpAccountData,
  opts?: { secure?: boolean }
): string {
  const value = Buffer.from(JSON.stringify(data)).toString("base64");
  const maxAge = Math.max(0, data.expires - Math.floor(Date.now() / 1000));
  const parts = [
    `ep_account=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (opts?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// --- Cart cookie ---

export function parseEpCartCookie(value: string): string | null {
  return value || null;
}

export function buildEpCartCookieHeader(
  cartId: string,
  opts?: { secure?: boolean }
): string {
  const parts = [
    `ep_cart=${cartId}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=2592000",
  ];
  if (opts?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
