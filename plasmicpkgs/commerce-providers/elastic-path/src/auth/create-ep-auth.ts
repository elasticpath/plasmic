import { createEpSession, EpSession, EpSessionConfig } from "./session";

export interface EpAuthConfig {
  clientId: string;
  host: string;
  basePath?: string;
  cartMergeStrategy?: "merge" | "replace" | "prompt";
  checkout?: { sessionSecret: string };
  adapters?: { stripe?: { secretKey: string }; clover?: any };
  epClientSecret?: string;
}

export interface EpAuthResolvedConfig {
  basePath: string;
  cartMergeStrategy: "merge" | "replace" | "prompt";
  checkout?: { sessionSecret: string };
  adapters?: { stripe?: { secretKey: string }; clover?: any };
  epClientSecret?: string;
}

export interface EpAuth {
  api: {
    getSession(req: {
      cookies: Record<string, string>;
      headers?: Record<string, string>;
    }): Promise<EpSession>;
  };
  config: EpAuthResolvedConfig;
}

export function createEpAuth(input: EpAuthConfig): EpAuth {
  if (
    input.checkout?.sessionSecret &&
    input.checkout.sessionSecret.length < 16
  ) {
    throw new Error(
      "checkout.sessionSecret must be at least 16 characters"
    );
  }

  const sessionConfig: EpSessionConfig = {
    clientId: input.clientId,
    host: input.host,
  };

  const resolvedConfig: EpAuthResolvedConfig = Object.freeze({
    basePath: input.basePath ?? "/api/ep",
    cartMergeStrategy: input.cartMergeStrategy ?? "merge",
    checkout: input.checkout,
    adapters: input.adapters,
    epClientSecret: input.epClientSecret,
  });

  return {
    api: {
      getSession(req) {
        return createEpSession(
          req.cookies,
          sessionConfig,
          req.headers
        );
      },
    },
    config: resolvedConfig,
  };
}
