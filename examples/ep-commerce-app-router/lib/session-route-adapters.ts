/**
 * Adapters between Next.js NextRequest/Response and the framework-agnostic
 * SessionRequest/SessionResponse used by the package handlers.
 *
 * Route files are 6-line wrappers: build per-request context, adapt request,
 * call handler, adapt response. No business logic.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type {
  SessionRequest,
  SessionResponse,
} from "@elasticpath/plasmic-ep-commerce-elastic-path/server";

export async function toSessionRequest(
  req: NextRequest
): Promise<SessionRequest> {
  let body: Record<string, unknown> = {};
  // Some methods may have empty bodies; tolerate JSON parse failures.
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    body = {};
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const cookies: Record<string, string> = {};
  req.cookies.getAll().forEach((c) => {
    cookies[c.name] = c.value;
  });
  return { body, headers, cookies };
}

export function toNextResponse(res: SessionResponse): NextResponse {
  const r = NextResponse.json(res.body, { status: res.status });
  if (res.headers) {
    for (const [k, v] of Object.entries(res.headers)) {
      r.headers.set(k, v);
    }
  }
  return r;
}
