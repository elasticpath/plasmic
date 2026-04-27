/**
 * EP auth bootstrap middleware (PRD #273).
 *
 * RSC pages can't write cookies in Next 15, so any anonymous-session
 * mint that happens during page render is in-memory only. This
 * middleware runs BEFORE the page, mints an anonymous EP session via
 * the better-auth handler, and persists the resulting cookies. After
 * this fires once, every subsequent request carries
 * `better-auth.session_token` + `better-auth.session_data`, the
 * catchall page reads them via `epAuth.api.getSession({cookies})`,
 * and the client-side EP SDK receives the same `serverToken` via
 * globalContextsProps — no localStorage fallback.
 */
import { epAuthMiddleware } from "@elasticpath/plasmic-ep-commerce-elastic-path/server";
import { epAuth } from "@/lib/ep-auth";

export const middleware = epAuthMiddleware(epAuth);

// Use the Node.js runtime (Next 15+ feature). The auth handler chain
// pulls in `better-auth` + `jose` + `@noble/hashes`, plus our
// `session-context.ts` uses `eval("require")` to keep `async_hooks` out
// of the browser bundle — both of which are unavailable in Edge Runtime.
export const config = {
  runtime: "nodejs",
  // Run on every request EXCEPT:
  //   - _next/* (Next assets)
  //   - api/ep/* (the auth handler itself; bootstrapping it would loop)
  //   - paths with a file extension (favicon.ico, .png, etc.)
  matcher: ["/((?!_next|api/ep|.*\\..*).*)"],
};
