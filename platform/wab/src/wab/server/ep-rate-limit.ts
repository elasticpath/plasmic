import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { EntityManager } from "typeorm";
import Redis from "ioredis";
import { logger } from "@/wab/server/observability";

const SCOPE_CACHE_TTL_SEC = parseInt(
  process.env.RATE_LIMIT_SCOPE_CACHE_TTL_SEC ?? "300",
  10
);

let _redisClient: Redis | undefined;

function getRedisClient(): Redis | undefined {
  if (!process.env.REDIS_HOST) {
    return undefined;
  }
  if (!_redisClient) {
    _redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
      password: process.env.REDIS_AUTH_TOKEN,
      tls: process.env.REDIS_TLS === "false" ? undefined : {},
      lazyConnect: true,
    });
  }
  return _redisClient;
}

// Parses "id:token,..." headers (x-plasmic-api-project-tokens, x-plasmic-api-cms-tokens)
export function parseTokenIds(tokenHeader: string | undefined): string[] {
  if (!tokenHeader || typeof tokenHeader !== "string") {
    return [];
  }
  return tokenHeader
    .trim()
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter(Boolean);
}

// Returns rate limit keys for each project, keyed by workspace or team.
// Checks Redis cache first; falls back to a single DB query for uncached IDs.
// Cached for SCOPE_CACHE_TTL_SEC so hot traffic never hits the DB.
async function resolveProjectScopeKeys(
  redis: Redis,
  em: EntityManager,
  projectIds: string[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  const uncached: string[] = [];

  const cached = await redis.mget(
    ...projectIds.map((id) => `cache:project:${id}:scope`)
  );
  for (const [i, value] of cached.entries()) {
    if (value) {
      keys.add(value);
    } else {
      uncached.push(projectIds[i]);
    }
  }

  if (uncached.length === 0) {
    return keys;
  }

  const rows: { id: string; workspaceId: string | null; teamId: string | null }[] =
    await em.query(
      `SELECT p.id, p."workspaceId", w."teamId"
       FROM project p
       LEFT JOIN workspace w ON w.id = p."workspaceId"
       WHERE p.id = ANY($1)`,
      [uncached]
    );

  const cachePipeline = redis.pipeline();
  for (const row of rows) {
    const key = row.workspaceId
      ? `rl:workspace:${row.workspaceId}`
      : row.teamId
      ? `rl:team:${row.teamId}`
      : null;

    if (key) {
      keys.add(key);
      cachePipeline.setex(`cache:project:${row.id}:scope`, SCOPE_CACHE_TTL_SEC, key);
    }
  }
  await cachePipeline.exec();

  return keys;
}

// Returns rate limit keys for each CMS database, keyed by workspace or team.
async function resolveCmsScopeKeys(
  redis: Redis,
  em: EntityManager,
  databaseIds: string[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  const uncached: string[] = [];

  const cached = await redis.mget(
    ...databaseIds.map((id) => `cache:cms:${id}:scope`)
  );
  for (const [i, value] of cached.entries()) {
    if (value) {
      keys.add(value);
    } else {
      uncached.push(databaseIds[i]);
    }
  }

  if (uncached.length === 0) {
    return keys;
  }

  const rows: { id: string; workspaceId: string; teamId: string | null }[] =
    await em.query(
      `SELECT d.id, d."workspaceId", w."teamId"
       FROM cms_database d
       LEFT JOIN workspace w ON w.id = d."workspaceId"
       WHERE d.id = ANY($1)`,
      [uncached]
    );

  const cachePipeline = redis.pipeline();
  for (const row of rows) {
    const key = row.workspaceId
      ? `rl:workspace:${row.workspaceId}`
      : row.teamId
      ? `rl:team:${row.teamId}`
      : null;

    if (key) {
      keys.add(key);
      cachePipeline.setex(`cache:cms:${row.id}:scope`, SCOPE_CACHE_TTL_SEC, key);
    }
  }
  await cachePipeline.exec();

  return keys;
}

// Increments all rate limit keys, sets TTL on new keys, and enforces the limit.
// Returns true if the request was blocked (429 sent), false to continue.
async function enforceRateLimit(
  redis: Redis,
  res: Response,
  next: NextFunction,
  keys: Set<string>
): Promise<boolean> {
  const windowSec = parseInt(process.env.RATE_LIMIT_WINDOW_SEC ?? "60", 10);
  const limit = parseInt(process.env.RATE_LIMIT_PER_SCOPE ?? "6000", 10);

  const keyList = [...keys];

  const incrPipeline = redis.pipeline();
  for (const key of keyList) {
    incrPipeline.incr(key);
  }
  const incrResults = await incrPipeline.exec();

  const expirePipeline = redis.pipeline();
  for (const [i, key] of keyList.entries()) {
    const count = incrResults![i][1] as number;
    if (count === 1) {
      expirePipeline.expire(key, windowSec);
    }
  }
  await expirePipeline.exec();

  const counts = keyList.map((_, i) => incrResults![i][1] as number);
  const maxCount = Math.max(...counts);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - maxCount)));

  if (counts.some((count) => count > limit)) {
    res.status(429).json({ error: "Too many requests, please try again later." });
    return true;
  }
  return false;
}

// Rate limiter for loader endpoints, keyed by workspace.id or team.id resolved
// from x-plasmic-api-project-tokens. All workspaces/teams in a multi-project
// request are incremented independently. Fails open if Redis is unavailable.
export function createProjectScopeRateLimiter(): RequestHandler {
  const redis = getRedisClient();

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redis) {
      return next();
    }

    const projectIds = parseTokenIds(
      req.headers["x-plasmic-api-project-tokens"] as string | undefined
    );
    if (projectIds.length === 0) {
      return next();
    }

    try {
      const keys = await resolveProjectScopeKeys(redis, req.noTxMgr, projectIds);
      if (keys.size === 0) {
        return next();
      }
      const blocked = await enforceRateLimit(redis, res, next, keys);
      if (blocked) return;
    } catch (err) {
      logger().error("Rate limiter failed open", { err });
    }
    next();
  };
}

// Rate limiter for public CMS endpoints, keyed by workspace.id or team.id
// resolved from x-plasmic-api-cms-tokens. Fails open if Redis is unavailable.
export function createCmsScopeRateLimiter(): RequestHandler {
  const redis = getRedisClient();

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redis) {
      return next();
    }

    const databaseIds = parseTokenIds(
      req.headers["x-plasmic-api-cms-tokens"] as string | undefined
    );
    if (databaseIds.length === 0) {
      return next();
    }

    try {
      const keys = await resolveCmsScopeKeys(redis, req.noTxMgr, databaseIds);
      if (keys.size === 0) {
        return next();
      }
      const blocked = await enforceRateLimit(redis, res, next, keys);
      if (blocked) return;
    } catch (err) {
      logger().error("Rate limiter failed open", { err });
    }
    next();
  };
}
