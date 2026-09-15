import { describe, it, expect } from "vitest";
import { getRateLimitKey, RATE_LIMIT_TIERS } from "./rateLimit.js";

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
