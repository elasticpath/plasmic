import type { NextFunction, Request, Response } from "express";
import type { EntityManager } from "typeorm";
import type Redis from "ioredis";
import {
  createCmsScopeRateLimiter,
  createPreviewRateLimiter,
  createProjectScopeRateLimiter,
  createWriteRateLimiter,
  parseTokenIds,
} from "./ep-rate-limit";

// Use a plain function (not jest.fn) so resetMocks doesn't wipe the implementation.
// The loggerInstance spies are still reset between tests by resetMocks: true.
jest.mock("@/wab/server/observability", () => {
  const loggerInstance = { error: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return { logger: () => loggerInstance };
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockPipeline = {
  incr: jest.Mock;
  expire: jest.Mock;
  setex: jest.Mock;
  exec: jest.Mock;
};

function createMockPipeline(
  counters: Record<string, number>,
  cache: Record<string, string>
): MockPipeline {
  const results: [null, any][] = [];
  const pipe: MockPipeline = {
    incr: jest.fn((key: string) => {
      counters[key] = (counters[key] ?? 0) + 1;
      results.push([null, counters[key]]);
      return pipe;
    }),
    expire: jest.fn((_key: string, _ttl: number) => {
      results.push([null, 1]);
      return pipe;
    }),
    setex: jest.fn((key: string, _ttl: number, value: string) => {
      cache[key] = value;
      results.push([null, "OK"]);
      return pipe;
    }),
    exec: jest.fn(() => Promise.resolve([...results])),
  };
  return pipe;
}

type MockRedis = Redis & { _pipelines: MockPipeline[] };

function createMockRedis(
  cache: Record<string, string> = {},
  counters: Record<string, number> = {}
): { redis: MockRedis; cache: Record<string, string>; counters: Record<string, number> } {
  const pipelines: MockPipeline[] = [];
  const redis = {
    mget: jest.fn((...keys: string[]) =>
      Promise.resolve(keys.map((k) => cache[k] ?? null))
    ),
    pipeline: jest.fn(() => {
      const p = createMockPipeline(counters, cache);
      pipelines.push(p);
      return p;
    }),
    _pipelines: pipelines,
  } as unknown as MockRedis;
  return { redis, cache, counters };
}

function createMockEm(
  rows: { id: string; workspaceId: string | null; teamId: string | null }[] = []
): EntityManager {
  return { query: jest.fn().mockResolvedValue(rows) } as unknown as EntityManager;
}

function makeProjectReq(
  tokens: string | undefined,
  em: EntityManager = createMockEm()
): Request {
  return {
    headers: { "x-plasmic-api-project-tokens": tokens },
    noTxMgr: em,
  } as unknown as Request;
}

function makeCmsReq(
  tokens: string | undefined,
  em: EntityManager = createMockEm()
): Request {
  return {
    headers: { "x-plasmic-api-cms-tokens": tokens },
    noTxMgr: em,
  } as unknown as Request;
}

function makeRes(): { res: Response; setHeader: jest.Mock; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const res = { setHeader, status, json } as unknown as Response;
  return { res, setHeader, status, json };
}

// ---------------------------------------------------------------------------
// parseTokenIds
// ---------------------------------------------------------------------------

describe("parseTokenIds", () => {
  it("parses a single project token", () => {
    expect(parseTokenIds("abc123:secrettoken")).toEqual(["abc123"]);
  });

  it("parses multiple project tokens", () => {
    expect(parseTokenIds("abc123:token1,def456:token2,ghi789:token3")).toEqual(
      ["abc123", "def456", "ghi789"]
    );
  });

  it("trims whitespace around entries", () => {
    expect(parseTokenIds(" abc123:token1 , def456:token2 ")).toEqual([
      "abc123",
      "def456",
    ]);
  });

  it("returns empty array for undefined header", () => {
    expect(parseTokenIds(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTokenIds("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseTokenIds("   ")).toEqual([]);
  });

  it("filters out entries with no project id", () => {
    expect(parseTokenIds(":token1,abc123:token2")).toEqual(["abc123"]);
  });

  it("handles entry with no token part", () => {
    // projectId is present even if token is missing — we only extract the id
    expect(parseTokenIds("abc123:,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("handles entry with no colon separator", () => {
    // no colon means split gives one part — treated as projectId with no token
    expect(parseTokenIds("abc123,def456:token2")).toEqual(["abc123", "def456"]);
  });

  it("preserves duplicate project ids", () => {
    // deduplication is not the responsibility of the parser
    expect(parseTokenIds("abc123:token1,abc123:token2")).toEqual([
      "abc123",
      "abc123",
    ]);
  });
});

// ---------------------------------------------------------------------------
// createProjectScopeRateLimiter
// ---------------------------------------------------------------------------

describe("createProjectScopeRateLimiter", () => {
  it("calls next() immediately when header is absent", async () => {
    const { redis } = createMockRedis();
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq(undefined), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(redis.mget).not.toHaveBeenCalled();
  });

  it("calls next() immediately when redis is null", async () => {
    const middleware = createProjectScopeRateLimiter({ redis: null, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() when project resolves to no scope key", async () => {
    const { redis } = createMockRedis();
    // DB returns no rows — project unknown
    const em = createMockEm([]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("increments the workspace counter and calls next() under limit", async () => {
    const { redis, counters } = createMockRedis();
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: "team1" }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(counters["rl:workspace:ws1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to team key when project has no workspace", async () => {
    const { redis, counters } = createMockRedis();
    const em = createMockEm([{ id: "proj1", workspaceId: null, teamId: "team1" }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(counters["rl:team:team1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 and does not call next() when count exceeds limit", async () => {
    // Pre-seed counter so one more INCR pushes it over limit=2
    const { redis } = createMockRedis({}, { "rl:workspace:ws1": 2 });
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 2 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      error: "Too many requests, please try again later.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets RateLimit-Limit and RateLimit-Remaining headers", async () => {
    const { redis } = createMockRedis();
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, setHeader } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(setHeader).toHaveBeenCalledWith("RateLimit-Limit", "10");
    expect(setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "9");
  });

  it("sets TTL on the key for the first request (count === 1)", async () => {
    const { redis } = createMockRedis();
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    // cache pipeline + incr pipeline + expire pipeline
    const expirePipeline = redis._pipelines[redis._pipelines.length - 1];
    expect(expirePipeline.expire).toHaveBeenCalledWith("rl:workspace:ws1", expect.any(Number));
  });

  it("skips TTL when the key already existed (count > 1)", async () => {
    const { redis } = createMockRedis({}, { "rl:workspace:ws1": 5 });
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    const expirePipeline = redis._pipelines[redis._pipelines.length - 1];
    expect(expirePipeline.expire).not.toHaveBeenCalled();
  });

  it("fails open and logs an error when Redis throws", async () => {
    const { logger } = jest.requireMock("@/wab/server/observability");
    const { redis } = createMockRedis();
    (redis.mget as jest.Mock).mockRejectedValue(new Error("Redis timeout"));
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger().error).toHaveBeenCalledWith(
      "Rate limiter failed open",
      expect.objectContaining({ err: expect.any(Error) })
    );
  }, 10000);

  it("increments separate keys for a multi-workspace request", async () => {
    const { redis, counters } = createMockRedis();
    const em = createMockEm([
      { id: "proj1", workspaceId: "ws1", teamId: null },
      { id: "proj2", workspaceId: "ws2", teamId: null },
    ]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token1,proj2:token2", em), res, next);

    expect(counters["rl:workspace:ws1"]).toBe(1);
    expect(counters["rl:workspace:ws2"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("uses cached scope key and skips DB query", async () => {
    const scopeCache = { "cache:project:proj1:scope": "rl:workspace:ws1" };
    const { redis } = createMockRedis(scopeCache);
    const em = createMockEm();
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(em.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("caches the resolved scope key in Redis after DB lookup", async () => {
    const { redis, cache } = createMockRedis();
    const em = createMockEm([{ id: "proj1", workspaceId: "ws1", teamId: null }]);
    const middleware = createProjectScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeProjectReq("proj1:token", em), res, next);

    expect(cache["cache:project:proj1:scope"]).toBe("rl:workspace:ws1");
  });
});

// ---------------------------------------------------------------------------
// createCmsScopeRateLimiter
// ---------------------------------------------------------------------------

describe("createCmsScopeRateLimiter", () => {
  it("calls next() immediately when cms tokens header is absent", async () => {
    const { redis } = createMockRedis();
    const middleware = createCmsScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeCmsReq(undefined), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(redis.mget).not.toHaveBeenCalled();
  });

  it("resolves database → workspace scope using cms: cache prefix", async () => {
    const { redis, cache } = createMockRedis();
    const em = createMockEm([{ id: "db1", workspaceId: "ws1", teamId: null }]);
    const middleware = createCmsScopeRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeCmsReq("db1:token", em), res, next);

    expect(cache["cache:cms:db1:scope"]).toBe("rl:workspace:ws1");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when CMS database scope exceeds limit", async () => {
    const { redis } = createMockRedis({}, { "rl:workspace:ws1": 5 });
    const em = createMockEm([{ id: "db1", workspaceId: "ws1", teamId: null }]);
    const middleware = createCmsScopeRateLimiter({ redis, limit: 5 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, status } = makeRes();

    await middleware(makeCmsReq("db1:token", em), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Identity request helpers
// ---------------------------------------------------------------------------

function makeUserReq(userId: string): Request {
  return { user: { id: userId }, ip: "1.2.3.4" } as unknown as Request;
}

function makeTeamReq(teamId: string): Request {
  return { apiTeam: { id: teamId }, ip: "1.2.3.4" } as unknown as Request;
}


// ---------------------------------------------------------------------------
// createPreviewRateLimiter
// ---------------------------------------------------------------------------

describe("createPreviewRateLimiter", () => {
  it("calls next() immediately when redis is null", async () => {
    const middleware = createPreviewRateLimiter({ redis: null, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("increments rl:user:{id} for session/PAT requests", async () => {
    const { redis, counters } = createMockRedis();
    const middleware = createPreviewRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(counters["rl:user:user1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("increments rl:team:{id} for team API token requests", async () => {
    const { redis, counters } = createMockRedis();
    const middleware = createPreviewRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeTeamReq("team1"), res, next);

    expect(counters["rl:team:team1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() without incrementing when no identity on request", async () => {
    const { redis, counters } = createMockRedis();
    const middleware = createPreviewRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware({} as Request, res, next);

    expect(Object.keys(counters)).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 and does not call next() when count exceeds limit", async () => {
    const { redis } = createMockRedis({}, { "rl:user:user1": 5 });
    const middleware = createPreviewRateLimiter({ redis, limit: 5 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, status, json } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      error: "Too many requests, please try again later.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets RateLimit-Limit and RateLimit-Remaining headers", async () => {
    const { redis } = createMockRedis();
    const middleware = createPreviewRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, setHeader } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(setHeader).toHaveBeenCalledWith("RateLimit-Limit", "10");
    expect(setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "9");
  });

  it("fails open and logs an error when Redis throws", async () => {
    const { logger } = jest.requireMock("@/wab/server/observability");
    const { redis } = createMockRedis();
    (redis.pipeline as jest.Mock).mockImplementation(() => {
      throw new Error("Redis timeout");
    });
    const middleware = createPreviewRateLimiter({ redis, limit: 100 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger().error).toHaveBeenCalledWith(
      "Rate limiter failed open",
      expect.objectContaining({ err: expect.any(Error) })
    );
  });
});

// ---------------------------------------------------------------------------
// createWriteRateLimiter
// ---------------------------------------------------------------------------

describe("createWriteRateLimiter", () => {
  it("calls next() immediately when redis is null", async () => {
    const middleware = createWriteRateLimiter({ redis: null, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("increments rl:user:{id} for session/PAT requests", async () => {
    const { redis, counters } = createMockRedis();
    const middleware = createWriteRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(counters["rl:user:user1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("increments rl:team:{id} for team API token requests", async () => {
    const { redis, counters } = createMockRedis();
    const middleware = createWriteRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeTeamReq("team1"), res, next);

    expect(counters["rl:team:team1"]).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 and does not call next() when count exceeds limit", async () => {
    const { redis } = createMockRedis({}, { "rl:user:user1": 10 });
    const middleware = createWriteRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res, status } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("fails open and logs an error when Redis throws", async () => {
    const { logger } = jest.requireMock("@/wab/server/observability");
    const { redis } = createMockRedis();
    (redis.pipeline as jest.Mock).mockImplementation(() => {
      throw new Error("Redis timeout");
    });
    const middleware = createWriteRateLimiter({ redis, limit: 10 });
    const next = jest.fn() as unknown as NextFunction;
    const { res } = makeRes();

    await middleware(makeUserReq("user1"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger().error).toHaveBeenCalledWith(
      "Rate limiter failed open",
      expect.objectContaining({ err: expect.any(Error) })
    );
  });
});
