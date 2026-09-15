import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Two tiers now that a request can be attributed to a signed-in user (see
// api/_lib/auth.js) instead of only an IP — daily windows, not hourly, per product
// decision: anonymous stays low enough to discourage abuse of the free Groq/Apify quota,
// signed-in gets a real bump as the incentive to create an account.
export const RATE_LIMIT_TIERS = {
  anonymous: { max: 3, window: "1 d" },
  authenticated: { max: 15, window: "1 d" },
};

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

// tier: "anonymous" | "authenticated" — each gets its own Upstash sliding-window bucket
// (a distinct `prefix`, so the same key string can never collide across tiers).
export function createRatelimit(tier) {
  const { max, window } = RATE_LIMIT_TIERS[tier];
  return new Ratelimit({
    redis: createRedisClient(),
    limiter: Ratelimit.slidingWindow(max, window),
    prefix: `roastify:${tier}`,
  });
}

// Keyed by user id when signed in, IP when not — so a signed-in user's quota travels
// with their account rather than the device/network they happen to be on, and switching
// between anonymous and signed-in use on the same device doesn't share a bucket.
export function getRateLimitKey(user, ip) {
  return user ? `user:${user.id}` : `ip:${ip}`;
}
