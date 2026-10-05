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
    /* ignore */
  }
}

export async function callEpDesign<T>(
  fnName: string,
  args: Record<string, unknown>,
  fallback: T,
  realm: EpDesignRealm
): Promise<T> {
  if (!isEpDesignFnName(fnName)) {
    if (realm === "artboard") return fallback;
    throw makeEpCallError({
      code: "design_fn_not_served",
      message:
        `${epDesignFnNotServedMessage(fnName)} Bindings on "${fnName}" are ` +
        `verifiable on the canvas and at runtime, not in this panel.`,
    });
  }

  let res: Response;
  try {
    res = await fetch(`${DESIGN_PATH}/${fnName}`, {
      method: "POST",
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
