import type { RequestHandler } from "express";
import type { EntityManager } from "typeorm";
import Redis from "ioredis";

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

export function parseProjectIds(tokenHeader: string | undefined): string[] {
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
async function resolveRateLimitKeys(
  redis: Redis,
  em: EntityManager,
  projectIds: string[]
): Promise<Set<string>> {
  const keys = new Set<string>();
  const uncached: string[] = [];

  // Batch cache lookup
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

  // Single DB query for all uncached project IDs
  const rows: { id: string; workspaceId: string | null; teamId: string | null }[] =
    await em.query(
      `SELECT p.id, p."workspaceId", w."teamId"
       FROM project p
       LEFT JOIN workspace w ON w.id = p."workspaceId"
       WHERE p.id = ANY($1)`,
      [uncached]
    );

  // Cache results and collect keys
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

// Rate limiter keyed by workspace.id (= EP store.id) or team.id (= EP org.id).
// All workspaces/teams referenced by the request are incremented — a multi-project
// request spanning multiple workspaces counts against each of them.
// Fails open if Redis is unavailable — a Redis or DB error should never block traffic.
export function createProjectRateLimiter(): RequestHandler {
  const redis = getRedisClient();
  const windowSec = parseInt(process.env.RATE_LIMIT_WINDOW_SEC ?? "60", 10);
  const limit = parseInt(process.env.RATE_LIMIT_PER_PROJECT ?? "6000", 10);

  return async (req, res, next) => {
    if (!redis) {
      return next();
    }

    const projectIds = parseProjectIds(
      req.headers["x-plasmic-api-project-tokens"] as string | undefined
    );
    if (projectIds.length === 0) {
      return next();
    }

    try {
      const rateLimitKeys = await resolveRateLimitKeys(
        redis,
        req.noTxMgr,
        projectIds
      );

      if (rateLimitKeys.size === 0) {
        return next();
      }

      const keyList = [...rateLimitKeys];

      // Increment all keys in a single pipeline
      const incrPipeline = redis.pipeline();
      for (const key of keyList) {
        incrPipeline.incr(key);
      }
      const incrResults = await incrPipeline.exec();

      // Set TTL on newly created keys
      const expirePipeline = redis.pipeline();
      for (const [i, key] of keyList.entries()) {
        const count = incrResults![i][1] as number;
        if (count === 1) {
          expirePipeline.expire(key, windowSec);
        }
      }
      await expirePipeline.exec();

      // Check limits — any key over the limit blocks the request
      const counts = keyList.map((_, i) => incrResults![i][1] as number);
      const maxCount = Math.max(...counts);
      res.setHeader("RateLimit-Limit", String(limit));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - maxCount)));

      if (counts.some((count) => count > limit)) {
        res.status(429).json({ error: "Too many requests, please try again later." });
        return;
      }
    } catch {
      // Fail open — DB or Redis errors should not block legitimate traffic.
    }
    next();
  };
}
