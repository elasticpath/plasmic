import rateLimit, {
  RateLimitRequestHandler,
  ValueDeterminingMiddleware,
} from "express-rate-limit";

// IP-based limiter for public unauthenticated endpoints (image optimizer, demo data, static).
export function createPublicRateLimiter(): RateLimitRequestHandler {
  return createRateLimiter({
    windowMs: 60 * 1000,
    limit: 60,
  });
}

export function createRateLimiter({
  windowMs,
  limit,
  message = "Too many requests, please try again later.",
  skip,
}: {
  windowMs: number;
  limit: number;
  message?: string;
  skip?: ValueDeterminingMiddleware<boolean>;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    message,
    skip,
    standardHeaders: true,
    legacyHeaders: false,
    validate: {
      xForwardedForHeader: false,
      trustProxy: false,
    },
  });
}
