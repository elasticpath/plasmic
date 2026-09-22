import { readEpErrorCode, resolveConsumerOrigin } from "../browser-call";
import {
  EP_IDENTITY_OPERATION_NAMES,
  EP_IDENTITY_ROUTES,
  type EpIdentityClient,
  type EpIdentityOperationName,
} from "./operations";

export const DEFAULT_EP_BASE_PATH = "/api/ep";

export interface EpIdentityClientOptions {
  /** Where the auth handler was mounted; the value given to `createEpAuth`. */
  basePath?: string;
  fetch?: typeof fetch;
}

export interface EpIdentityError extends Error {
  code?: string;
  status: number;
}

/** The server's reason for refusing, e.g. `account_lapsed`. */
export function epIdentityErrorCode(err: unknown): string | undefined {
  return readEpErrorCode(err);
}

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/$/, "");
  return trimmed.startsWith("/") || trimmed === "" ? trimmed : `/${trimmed}`;
}

async function readRefusal(
  response: Response,
  operation: EpIdentityOperationName
): Promise<EpIdentityError> {
  let code: string | undefined;
  let message = `ep ${operation} failed (${response.status})`;
  try {
    const body = (await response.json()) as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    } | null;
    if (body && typeof body === "object") {
      const raw = typeof body.code === "string" ? body.code : body.error;
      if (typeof raw === "string" && raw) code = raw;
      if (typeof body.message === "string" && body.message) {
        message = body.message;
      }
    }
  } catch {
    // A refusal with no readable body is still a refusal.
  }
  const err = new Error(message) as EpIdentityError;
  err.status = response.status;
  if (code) err.code = code;
  return err;
}

export function createEpIdentityClient(
  options: EpIdentityClientOptions = {}
): EpIdentityClient {
  const basePath = normalizeBasePath(options.basePath ?? DEFAULT_EP_BASE_PATH);
  const doFetch = options.fetch ?? ((...args) => fetch(...args));

  async function call(
    operation: EpIdentityOperationName,
    input?: unknown
  ): Promise<unknown> {
    const route = EP_IDENTITY_ROUTES[operation];
    const url = `${resolveConsumerOrigin()}${basePath}${route.path}`;

    const init: RequestInit = { method: route.method, credentials: "include" };
    if (route.method === "POST") {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(input ?? {});
    }

    const response = await doFetch(url, init);
    if (!response.ok) throw await readRefusal(response, operation);

    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const client = {} as Record<string, (input?: unknown) => Promise<unknown>>;
  for (const operation of EP_IDENTITY_OPERATION_NAMES) {
    client[operation] = (input?: unknown) => call(operation, input);
  }
  return client as unknown as EpIdentityClient;
}
