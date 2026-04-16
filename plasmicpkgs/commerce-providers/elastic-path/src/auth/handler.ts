import { EpAuth } from "./create-ep-auth";
import { buildEpCartCookieHeader } from "./cookies";
import { EpSession } from "./session";

interface HandlerRequest {
  url: string;
  cookies: Record<string, string>;
  headers?: Record<string, string>;
  json(): Promise<any>;
}

type Handler = (req: HandlerRequest) => Promise<Response>;

function accountStatus(session: EpSession): string {
  if (session.isAuthenticated) return "authenticated";
  if (session.user === null && session.session) return "anonymous";
  return "anonymous";
}

function extractPath(url: string, basePath: string): string | null {
  const parsed = new URL(url, "http://localhost");
  const pathname = parsed.pathname;
  if (!pathname.startsWith(basePath)) return null;
  return pathname.slice(basePath.length) || "/";
}

function jsonResponse(
  data: any,
  status: number,
  setCookies: string[]
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of setCookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

async function handleRoute(
  req: HandlerRequest,
  method: string,
  epAuth: EpAuth
): Promise<Response> {
  const basePath = epAuth.config.basePath;
  const route = extractPath(req.url, basePath);

  if (route === null) {
    return jsonResponse({ error: "Not found" }, 404, []);
  }

  const session = await epAuth.api.getSession(req);
  const epHost = session.session?.host ?? "https://useast.api.elasticpath.com";
  const authHeaders = session.headers();
  const cookies: string[] = [];

  // Collect cookies from session (token refresh)
  const cookieCollector = {
    appendHeader(_name: string, value: string) {
      cookies.push(value);
    },
  };
  session.commitCookies(cookieCollector);

  const cartId = session.cart?.id;

  // GET /cart
  if (method === "GET" && route === "/cart") {
    if (!cartId) {
      return jsonResponse(
        { data: [], meta: {}, accountStatus: accountStatus(session) },
        200,
        cookies
      );
    }

    const epRes = await fetch(`${epHost}/v2/carts/${cartId}/items`, {
      headers: authHeaders,
    });
    const epData = await epRes.json();
    return jsonResponse(
      { ...epData, accountStatus: accountStatus(session) },
      epRes.ok ? 200 : epRes.status,
      cookies
    );
  }

  // POST /cart/items
  if (method === "POST" && route === "/cart/items") {
    const targetCartId = cartId ?? ""; // EP creates cart on first add if needed
    const body = await req.json();

    const epRes = await fetch(`${epHost}/v2/carts/${targetCartId}/items`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ data: body }),
    });
    const epData = await epRes.json();

    // Set cart cookie if this was the first cart operation
    if (!cartId && epData.data?.[0]?.cart_id) {
      cookies.push(buildEpCartCookieHeader(epData.data[0].cart_id));
    }

    return jsonResponse(
      { ...epData, accountStatus: accountStatus(session) },
      epRes.ok ? 200 : epRes.status,
      cookies
    );
  }

  // PATCH /cart/items/:id
  const patchMatch = route.match(/^\/cart\/items\/(.+)$/);
  if (method === "PATCH" && patchMatch) {
    const itemId = patchMatch[1];
    const body = await req.json();

    const epRes = await fetch(
      `${epHost}/v2/carts/${cartId}/items/${itemId}`,
      {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ data: body }),
      }
    );
    const epData = await epRes.json();
    return jsonResponse(
      { ...epData, accountStatus: accountStatus(session) },
      epRes.ok ? 200 : epRes.status,
      cookies
    );
  }

  // DELETE /cart/items/:id
  const deleteMatch = route.match(/^\/cart\/items\/(.+)$/);
  if (method === "DELETE" && deleteMatch) {
    const itemId = deleteMatch[1];

    const epRes = await fetch(
      `${epHost}/v2/carts/${cartId}/items/${itemId}`,
      {
        method: "DELETE",
        headers: authHeaders,
      }
    );
    const epData = await epRes.json();
    return jsonResponse(
      { ...epData, accountStatus: accountStatus(session) },
      epRes.ok ? 200 : epRes.status,
      cookies
    );
  }

  return jsonResponse({ error: "Not found" }, 404, cookies);
}

export function toNextJsHandler(epAuth: EpAuth) {
  return {
    GET: ((req: HandlerRequest) => handleRoute(req, "GET", epAuth)) as Handler,
    POST: ((req: HandlerRequest) =>
      handleRoute(req, "POST", epAuth)) as Handler,
    PATCH: ((req: HandlerRequest) =>
      handleRoute(req, "PATCH", epAuth)) as Handler,
    DELETE: ((req: HandlerRequest) =>
      handleRoute(req, "DELETE", epAuth)) as Handler,
  };
}
