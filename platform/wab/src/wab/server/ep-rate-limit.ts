import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { EntityManager } from "typeorm";
import Redis from "ioredis";
import { logger } from "@/wab/server/observability";

function parseEnvInt(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value ?? String(defaultValue), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const SCOPE_CACHE_TTL_SEC = parseEnvInt(
  process.env.RATE_LIMIT_SCOPE_CACHE_TTL_SEC,
  300
);

// Atomically increments the counter and sets its TTL on first use.
// Lua ensures INCR and EXPIRE are never split by a connection drop, preventing
// keys from being created without a TTL (and thus never expiring).
const INCR_EXPIRE_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

let _redisClient: Redis | undefined;

function getRedisClient(): Redis | undefined {
  if (!process.env.REDIS_HOST) {
    return undefined;
  }
  if (!_redisClient) {
    _redisClient = new Redis({
      host: process.env.REDIS_HOST,
      port: parseEnvInt(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_AUTH_TOKEN,
      tls: process.env.REDIS_TLS === "false" ? undefined : {},
      lazyConnect: true,
    });
  }
  return _redisClient;
}

export interface RateLimiterDeps {
  redis?: Redis | null;
  windowSec?: number;
  limit?: number;
}

// Resolves the rate limit bucket key from whatever the auth layer already set on the request.
// Team API token → rl:team:{id}, session/PAT → rl:user:{id}, no identity → null (skip limiting).
function resolveIdentityKey(req: Request): string | null {
  if (req.apiTeam) return `rl:team:${req.apiTeam.id}`;
  if (req.user) return `rl:user:${req.user.id}`;
  return null;
}

// Parses "id:token,..." headers (x-plasmic-api-project-tokens, x-plasmic-api-cms-tokens).
// Deduplicates IDs so the same project appearing twice doesn't waste Redis round-trips.
export function parseTokenIds(tokenHeader: string | undefined): string[] {
  if (!tokenHeader || typeof tokenHeader !== "string") {
    return [];
  }
  const seen = new Set<string>();
  return tokenHeader
    .trim()
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

const PROJECT_SCOPE_QUERY = `
  SELECT p.id, p."workspaceId", w."teamId"
  FROM project p
  LEFT JOIN workspace w ON w.id = p."workspaceId"
  WHERE p.id = ANY($1)`;

const CMS_SCOPE_QUERY = `
  SELECT d.id, d."workspaceId", w."teamId"
  FROM cms_database d
  LEFT JOIN workspace w ON w.id = d."workspaceId"
  WHERE d.id = ANY($1)`;

// Resolves rate limit keys for a set of entity IDs (projects or CMS databases),
// keyed by workspace or team. Checks Redis cache first; falls back to a single
// DB query for uncached IDs. Results are cached for SCOPE_CACHE_TTL_SEC so
// hot traffic never hits the DB.
async function resolveScopeKeys(
  redis: Redis,
  em: EntityManager,
  ids: string[],
  cachePrefix: string,
  query: string
): Promise<Set<string>> {
  const keys = new Set<string>();
  const uncached: string[] = [];

  const cached = await redis.mget(
    ...ids.map((id) => `${cachePrefix}:${id}:scope`)
  );
  for (const [i, value] of cached.entries()) {
    if (value) {
      keys.add(value);
    } else {
      uncached.push(ids[i]);
    }
  }

  if (uncached.length === 0) {
    return keys;
  }

  const rows: { id: string; workspaceId: string | null; teamId: string | null }[] =
    await em.query(query, [uncached]);

  const cachePipeline = redis.pipeline();
  for (const row of rows) {
    const key = row.workspaceId
      ? `rl:workspace:${row.workspaceId}`
      : row.teamId
      ? `rl:team:${row.teamId}`
      : null;

    if (key) {
      keys.add(key);
      cachePipeline.setex(`${cachePrefix}:${row.id}:scope`, SCOPE_CACHE_TTL_SEC, key);
    }
  }
  await cachePipeline.exec();

  return keys;
}

function resolveProjectScopeKeys(
  redis: Redis,
  em: EntityManager,
  projectIds: string[]
): Promise<Set<string>> {
  return resolveScopeKeys(redis, em, projectIds, "cache:project", PROJECT_SCOPE_QUERY);
}

function resolveCmsScopeKeys(
  redis: Redis,
  em: EntityManager,
  databaseIds: string[]
): Promise<Set<string>> {
  return resolveScopeKeys(redis, em, databaseIds, "cache:cms", CMS_SCOPE_QUERY);
}

// Resolves the rate limit bucket key(s) for a request regardless of auth method.
// Tries all auth methods in priority order and returns on the first match:
//   1. x-plasmic-api-project-tokens → workspace/team key (DB + Redis cache)
//   2. x-plasmic-api-cms-tokens     → workspace/team key (DB + Redis cache)
//   3. req.apiTeam (team API token) → rl:team:{id}
//   4. req.user (session / PAT)     → rl:user:{id}
// Returns an empty set when no auth is present — the request is skipped.
async function resolveRateLimitKeys(redis: Redis, req: Request): Promise<Set<string>> {
  const projectIds = parseTokenIds(
    req.headers["x-plasmic-api-project-tokens"] as string | undefined
  );
  if (projectIds.length > 0) {
    const keys = await resolveProjectScopeKeys(redis, req.noTxMgr, projectIds);
    if (keys.size > 0) return keys;
  }

  const cmsIds = parseTokenIds(
    req.headers["x-plasmic-api-cms-tokens"] as string | undefined
  );
  if (cmsIds.length > 0) {
    const keys = await resolveCmsScopeKeys(redis, req.noTxMgr, cmsIds);
    if (keys.size > 0) return keys;
  }

  const identityKey = resolveIdentityKey(req);
  if (identityKey) return new Set([identityKey]);

  return new Set();
}

// Increments all rate limit keys within their window and enforces the limit.
// Each key is incremented via a Lua script that also sets the TTL on first use,
// so INCR and EXPIRE are never split by a connection failure.
// Returns true if the request was blocked (429 sent), false to continue.
async function enforceRateLimit(
  redis: Redis,
  res: Response,
  keys: Set<string>,
  windowSec: number,
  limit: number
): Promise<boolean> {
  const keyList = [...keys];

  const pipeline = redis.pipeline();
  for (const key of keyList) {
    pipeline.eval(INCR_EXPIRE_SCRIPT, 1, key, String(windowSec));
  }
  const results = await pipeline.exec();

  if (!results) {
    return false;
  }

  // Per-key eval errors (e.g. Redis Cluster slot errors) are treated as count=0
  // so the request passes through — consistent with the fail-open philosophy.
  const counts = results.map(([err, count]) =>
    err != null ? 0 : (count as number)
  );
  const maxCount = Math.max(...counts);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - maxCount)));

  if (counts.some((count) => count > limit)) {
    res.status(429).json({ error: "Too many requests, please try again later." });
    return true;
  }
  return false;
}

// Shared factory for all rate limiters. Resolves the bucket key from whatever
// auth method the request used — project tokens, CMS tokens, team token, or
// session/PAT — so the same limit applies regardless of how you authenticate.
function makeRateLimiter(
  envVar: string,
  defaultLimit: number
): (deps?: RateLimiterDeps) => RequestHandler {
  return (deps?: RateLimiterDeps): RequestHandler => {
    const redis = deps?.redis !== undefined ? deps.redis : getRedisClient();
    const windowSec =
      deps?.windowSec ?? parseEnvInt(process.env.RATE_LIMIT_WINDOW_SEC, 60);
    const limit = deps?.limit ?? parseEnvInt(process.env[envVar], defaultLimit);

    return async (req: Request, res: Response, next: NextFunction) => {
      if (!redis) {
        return next();
      }
      try {
        const keys = await resolveRateLimitKeys(redis, req);
        if (keys.size === 0) return next();
        const blocked = await enforceRateLimit(redis, res, keys, windowSec, limit);
        if (blocked) return;
      } catch (err) {
        logger().error("Rate limiter failed open", { err });
      }
      next();
    };
  };
}

// Rate limiter for loader and CMS endpoints, keyed by workspace.id or team.id.
// All workspaces/teams in a multi-project request are incremented independently.
// Fails open if Redis is unavailable.
export const createProjectScopeRateLimiter = makeRateLimiter(
  "RATE_LIMIT_PER_SCOPE",
  6000
);

export const createCmsScopeRateLimiter = makeRateLimiter(
  "RATE_LIMIT_PER_SCOPE",
  6000
);

// Preview routes bypass S3 cache and trigger codegen on every call — tighter budget.
// Applies to all auth methods: project tokens, CMS tokens, team token, session/PAT.
export const createPreviewRateLimiter = makeRateLimiter(
  "RATE_LIMIT_PREVIEW_PER_SCOPE",
  600
);

// General authenticated API endpoints — studio CRUD, teams, workspaces, data sources, etc.
export const createGeneralApiRateLimiter = makeRateLimiter(
  "RATE_LIMIT_GENERAL_API_PER_USER",
  300
);

// Write/publish routes are expensive and low-frequency by design — much tighter budget.
export const createWriteRateLimiter = makeRateLimiter(
  "RATE_LIMIT_WRITE_PER_USER",
  60
);
