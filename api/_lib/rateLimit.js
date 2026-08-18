import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW = "1 h";

export function getClientIP(req) {
  // Try to get the real client IP from various headers
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
}

export function createRedisClient() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export function createRatelimit() {
  return new Ratelimit({
    redis: createRedisClient(),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW),
  });
}
