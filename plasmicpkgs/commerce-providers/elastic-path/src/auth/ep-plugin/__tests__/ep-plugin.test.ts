/**
 * Tracer for epPlugin (PRD #273).
 *
 * Verifies the smallest viable contract:
 *   - epPlugin() returns a value better-auth's `plugins:[]` array accepts
 *   - betterAuth({plugins:[epPlugin(...)]}) constructs without throwing
 *   - The resulting instance exposes auth.api.getSession (we don't call EP
 *     here — that's the next cycle's test)
 *
 * Crucially we instantiate WITHOUT a `database` option — proving the
 * plugin is compatible with stateless cookie-cache mode (the spike's
 * load-bearing property).
 *
 * Runs under vitest (not jest) — see ../../../../vitest.config.ts. Better-auth
 * is ESM-only and chains through dynamic-import-using deps; vitest handles
 * that natively. Jest's CJS-by-default transform cannot.
 */
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { epPlugin } from "../ep-plugin";

const SECRET = "x".repeat(48);

describe("epPlugin tracer (PRD #273)", () => {
  it("constructs a stateless betterAuth instance with no database", () => {
    const auth = betterAuth({
      secret: SECRET,
      plugins: [
        epPlugin({
          clientId: "test-client",
          host: "https://api.test.elasticpath.com",
        }),
      ],
      session: {
        cookieCache: {
          enabled: true,
          // jwe is the spike-verified strategy that survives cross-instance
          // reads when no database is configured. See
          // memory/project_better_auth_stateless_findings.md.
          strategy: "jwe",
          refreshCache: true,
        },
      },
    });

    expect(typeof auth.api.getSession).toBe("function");
  });

  it("exposes the EP-namespaced endpoints registered by the plugin", () => {
    const auth = betterAuth({
      secret: SECRET,
      plugins: [
        epPlugin({
          clientId: "test-client",
          host: "https://api.test.elasticpath.com",
        }),
      ],
    });

    // Endpoints surface on auth.api as <namespace><PascalCaseName>; we use
    // the namespace `ep`. PRD #273 calls for /ep/anonymous, /ep/refresh,
    // /ep/account/login, /ep/account/select, /ep/account/logout, and
    // /ep/cart/merge — but the tracer only pins the anonymous endpoint.
    // The rest are added in subsequent RED→GREEN cycles.
    expect(typeof (auth.api as any).epAnonymous).toBe("function");
  });
});
