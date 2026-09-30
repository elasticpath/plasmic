/**
 * Browser-side transport for Studio design time.
 *
 * At design time the shopper session is out of reach: better-auth's
 * `SameSite=Lax` cookie does not travel into Studio's editing frame once a
 * customer hosts their app host on their own registrable domain. So design
 * time reads the catalog from a route that never touches the session at all —
 * `createEpDesignRoutes`, mounted at `app/api/ep/design/[fn]/route.ts`.
 *
 * The URL is relative, so it resolves against whatever document serves the
 * artboard. Nothing here retries the session proxy: the realm is decided once,
 * before the request, and a failure here never falls back to the proxy.
 */
import { makeEpCallError, readEpCallError } from "./call-error";
import {
  epDesignFnNotServedMessage,
  isEpDesignFnName,
} from "./design-fn-names";
import type { EpDesignRealm } from "./design-realm";

const DESIGN_PATH = "/api/ep/design";

const MOUNT_SNIPPET =
  'app/api/ep/design/[fn]/route.ts:\n\n' +
  '  import { createEpDesignRoutes } from\n' +
  '    "@elasticpath/plasmic-ep-commerce-elastic-path/server";\n' +
  '  import { epAuth } from "@/lib/ep-auth";\n\n' +
  '  const routes = createEpDesignRoutes(epAuth);\n' +
  '  export const POST = routes.handle;\n' +
  '  export const OPTIONS = routes.options;';

let warnedMissingRoute = false;

/** Test seam — the warning is deliberately once per page load. */
export function resetEpDesignRouteWarning(): void {
  warnedMissingRoute = false;
}

function warnMissingRouteOnce(): void {
  if (warnedMissingRoute) return;
  warnedMissingRoute = true;
  try {
    console.warn(
      "[ep-commerce] Studio design time is showing labelled sample data: no " +
        `route answers ${DESIGN_PATH}/<fn>. Mount it in ` +
        MOUNT_SNIPPET
    );
  } catch {
    // Reporting the problem must not become a second problem.
  }
}

export async function callEpDesign<T>(
  fnName: string,
  args: Record<string, unknown>,
  fallback: T,
  realm: EpDesignRealm
): Promise<T> {
  // A name this route cannot serve soft-fails on the artboard and throws in
  // the Configure panel: soft-fail where a mock floor exists, throw where none
  // does. The canvas has one, and the fallback is what lets the `"Sample"`
  // fixtures render in its place. Nothing sits behind the panel, so the same
  // value there is indistinguishable from a wrong argument binding, on the one
  // surface a designer opens to check one.
  if (!isEpDesignFnName(fnName)) {
    if (realm === "artboard") return fallback;
    throw makeEpCallError({
      code: "design_fn_not_served",
      message:
        `${epDesignFnNotServedMessage(fnName)} Bindings on "${fnName}" are ` +
        `verifiable on the canvas and at runtime, not in this panel.`,
    });
  }

  // Everything below is a transport failure, and every one of them throws,
  // in both realms. A caller's fallback is its own empty shape, not a mock
  // floor: `null` from `getProduct` means "no such product", and a designer
  // who has not mounted the route would read "Product not found" off a route
  // that was never asked. The components reach their labelled `"Sample"`
  // fixtures through their error branch, so a throw is what renders them.
  let res: Response;
  try {
    res = await fetch(`${DESIGN_PATH}/${fnName}`, {
      method: "POST",
      // No credentials: the route reads no session, and sending one would
      // invite a reader to start reading it.
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`ep design ${fnName}: network error`);
  }

  if (!res.ok) {
    const info = await readEpCallError(res, `ep design ${fnName}`);
    if (info.code === "route_not_found") warnMissingRouteOnce();
    throw makeEpCallError(info);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`ep design ${fnName}: invalid JSON response`);
  }
}
