/**
 * Demo route for PRD #273 — mounts the better-auth-backed EP auth at
 * /api/ep-better/* in parallel to the legacy /api/ep/*.
 *
 * Curl examples:
 *   POST /api/ep-better/ep/anonymous → real EP /oauth/access_token call,
 *     Set-Cookie: better-auth.session_token + session_data
 *   GET  /api/ep-better/get-session  → reads cookies, returns session
 *     including epAccessToken, epClientId, epHost, epExpires
 *
 * The legacy /api/ep/* keeps its own handler — both can run side by side
 * until better-auth reaches feature parity (account/cart/refresh).
 */
import { toNextJsHandler } from "better-auth/next-js";
import { epBetterAuth } from "@/lib/ep-better-auth";

export const { GET, POST } = toNextJsHandler(epBetterAuth);
