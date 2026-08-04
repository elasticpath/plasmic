import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEV_FALLBACK_SECRET,
  DEV_SECRET_SENTINELS,
  assertNonSentinelSecret,
  assertProductionSecret,
  resolveAuthSecret,
} from "../production-guard";

const GOOD_SECRET = "s".repeat(48);
const LABEL = { label: "createEpAuth" };

let originalNodeEnv: string | undefined;
let originalNextPhase: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalNextPhase = process.env.NEXT_PHASE;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setEnv("NODE_ENV", originalNodeEnv);
  setEnv("NEXT_PHASE", originalNextPhase);
  vi.restoreAllMocks();
});

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as any)[key];
  else (process.env as any)[key] = value;
}

function inProduction() {
  setEnv("NODE_ENV", "production");
  setEnv("NEXT_PHASE", undefined);
}

function inDevelopment() {
  setEnv("NODE_ENV", "development");
  setEnv("NEXT_PHASE", undefined);
}

describe("assertProductionSecret in production", () => {
  beforeEach(inProduction);

  it("accepts a long unique secret", () => {
    expect(() => assertProductionSecret(GOOD_SECRET, LABEL)).not.toThrow();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("throws when no secret is configured", () => {
    expect(() => assertProductionSecret(undefined, LABEL)).toThrow(
      /no secret is configured/
    );
    expect(() => assertProductionSecret("", LABEL)).toThrow();
  });

  it.each(DEV_SECRET_SENTINELS)("throws on the sentinel %s", (sentinel) => {
    expect(() => assertProductionSecret(sentinel, LABEL)).toThrow(
      /public example placeholder/
    );
  });

  it("throws on a secret shorter than 32 characters", () => {
    expect(() => assertProductionSecret("z".repeat(31), LABEL)).toThrow(
      /at least 32/
    );
    expect(() => assertProductionSecret("z".repeat(32), LABEL)).not.toThrow();
  });

  it("names the failing call site in the message", () => {
    expect(() => assertProductionSecret(undefined, LABEL)).toThrow(
      /^createEpAuth:/
    );
  });
});

describe("assertProductionSecret during a production build", () => {
  beforeEach(() => {
    setEnv("NODE_ENV", "production");
    setEnv("NEXT_PHASE", "phase-production-build");
  });

  it("warns instead of throwing so build-time env injection still builds", () => {
    expect(() => assertProductionSecret(undefined, LABEL)).not.toThrow();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("no secret is configured")
    );
  });

  it("still warns on a sentinel", () => {
    expect(() =>
      assertProductionSecret(DEV_SECRET_SENTINELS[0], LABEL)
    ).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("assertProductionSecret under an unrecognised NODE_ENV", () => {
  it.each(["staging", "preview", "", undefined])(
    "enforces when NODE_ENV is %p, since only development and test are trusted",
    (value) => {
      setEnv("NODE_ENV", value as string | undefined);
      setEnv("NEXT_PHASE", undefined);
      expect(() => assertProductionSecret(undefined, LABEL)).toThrow();
      expect(() =>
        assertProductionSecret(DEV_SECRET_SENTINELS[0], LABEL)
      ).toThrow();
    }
  );

  it("never hands back the published fallback outside development", () => {
    setEnv("NODE_ENV", "staging");
    setEnv("NEXT_PHASE", undefined);
    expect(() => resolveAuthSecret(undefined, LABEL)).toThrow();
  });

  it("treats the test environment as development", () => {
    setEnv("NODE_ENV", "test");
    setEnv("NEXT_PHASE", undefined);
    expect(() => assertProductionSecret(undefined, LABEL)).not.toThrow();
  });
});

describe("assertNonSentinelSecret", () => {
  it("rejects a sentinel checkout secret in production but ignores length", () => {
    inProduction();
    expect(() =>
      assertNonSentinelSecret("dev-secret-min-16-chars", {
        label: "checkout.sessionSecret",
      })
    ).toThrow(/public example placeholder/);
    // Short but unique is the checkout secret's own ≥16 rule, not this guard's.
    expect(() =>
      assertNonSentinelSecret("a-unique-17-chars", {
        label: "checkout.sessionSecret",
      })
    ).not.toThrow();
  });

  it("warns instead of throwing in development", () => {
    inDevelopment();
    expect(() =>
      assertNonSentinelSecret("dev-secret-min-16-chars", {
        label: "checkout.sessionSecret",
      })
    ).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("assertProductionSecret outside production", () => {
  beforeEach(inDevelopment);

  it("warns rather than throwing on every finding", () => {
    expect(() => assertProductionSecret(undefined, LABEL)).not.toThrow();
    expect(() =>
      assertProductionSecret(DEV_SECRET_SENTINELS[0], LABEL)
    ).not.toThrow();
    expect(() => assertProductionSecret("short", LABEL)).not.toThrow();
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it("stays silent for a well-formed secret", () => {
    assertProductionSecret(GOOD_SECRET, LABEL);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("resolveAuthSecret", () => {
  it("returns the configured secret unchanged", () => {
    inDevelopment();
    expect(resolveAuthSecret(GOOD_SECRET, LABEL)).toBe(GOOD_SECRET);
  });

  it("substitutes the dev fallback when nothing is configured", () => {
    inDevelopment();
    expect(resolveAuthSecret(undefined, LABEL)).toBe(DEV_FALLBACK_SECRET);
  });

  it("propagates the production throw", () => {
    inProduction();
    expect(() => resolveAuthSecret(undefined, LABEL)).toThrow();
  });

  it("keeps the dev fallback out of production by listing it as a sentinel", () => {
    inProduction();
    expect(() => resolveAuthSecret(DEV_FALLBACK_SECRET, LABEL)).toThrow(
      /public example placeholder/
    );
  });
});
