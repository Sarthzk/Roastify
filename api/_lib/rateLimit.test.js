import { describe, it, expect } from "vitest";
import { getRateLimitKey, RATE_LIMIT_TIERS, createRatelimit } from "./rateLimit.js";

describe("RATE_LIMIT_TIERS", () => {
  it("gives authenticated a higher daily cap than anonymous", () => {
    expect(RATE_LIMIT_TIERS.authenticated.max).toBeGreaterThan(RATE_LIMIT_TIERS.anonymous.max);
  });

  it("uses a daily window for both tiers", () => {
    expect(RATE_LIMIT_TIERS.anonymous.window).toBe("1 d");
    expect(RATE_LIMIT_TIERS.authenticated.window).toBe("1 d");
  });
});

describe("getRateLimitKey", () => {
  it("keys by user id when a user is present, regardless of IP", () => {
    expect(getRateLimitKey({ id: "user-1" }, "1.2.3.4")).toBe("user:user-1");
  });

  it("keys by IP when there is no user (anonymous)", () => {
    expect(getRateLimitKey(null, "1.2.3.4")).toBe("ip:1.2.3.4");
  });

  it("produces distinct keys for the same person signed in vs. anonymous on the same device", () => {
    const anonKey = getRateLimitKey(null, "1.2.3.4");
    const userKey = getRateLimitKey({ id: "user-1" }, "1.2.3.4");
    expect(anonKey).not.toBe(userKey);
  });
});

describe("createRatelimit tier isolation", () => {
  // getKey() is the real Ratelimit instance's own method for building the exact Redis
  // key a request would consume against — the most direct way to prove the two tiers
  // never share a bucket, rather than just asserting their `prefix` strings differ.
  it("gives each tier its own Redis key prefix", () => {
    const anonymous = createRatelimit("anonymous");
    const authenticated = createRatelimit("authenticated");
    expect(anonymous.prefix).not.toBe(authenticated.prefix);
  });

  it("keys signing in from the same IP into a genuinely different bucket than the anonymous one, not just a different key string on the same bucket", () => {
    const ip = "1.2.3.4";
    const anonymousRatelimit = createRatelimit("anonymous");
    const authenticatedRatelimit = createRatelimit("authenticated");

    // Before signing in: anonymous tier, keyed by IP.
    const anonymousKey = anonymousRatelimit.getKey(getRateLimitKey(null, ip));
    // After signing in from the very same device/IP: authenticated tier, keyed by user id.
    const signedInKey = authenticatedRatelimit.getKey(getRateLimitKey({ id: "user-1" }, ip));

    expect(anonymousKey).not.toBe(signedInKey);
  });

  it("stays isolated even in the contrived case where a user id string collides with an IP string", () => {
    const collidingId = "1.2.3.4";
    const anonymousRatelimit = createRatelimit("anonymous");
    const authenticatedRatelimit = createRatelimit("authenticated");

    const anonymousKey = anonymousRatelimit.getKey(getRateLimitKey(null, collidingId));
    const signedInKey = authenticatedRatelimit.getKey(getRateLimitKey({ id: collidingId }, "9.9.9.9"));

    // Different tier prefixes alone guarantee this, regardless of the id/IP collision.
    expect(anonymousKey).not.toBe(signedInKey);
  });
});
