import { describe, it, expect, vi } from "vitest";

const setCalls = [];
const mockRedis = {
  get: async () => null,
  set: async (key, value, opts) => {
    setCalls.push({ key, value, opts });
  },
};

vi.mock("./rateLimit.js", () => ({
  createRedisClient: () => mockRedis,
}));

const { withScrapeCache } = await import("./scrapeCache.js");

describe("withScrapeCache TTL per type", () => {
  it("caches GitHub scrapes for 1 hour", async () => {
    setCalls.length = 0;
    await withScrapeCache("github", "octocat", async () => "result");
    expect(setCalls[0].opts).toEqual({ ex: 60 * 60 });
  });

  it("caches Instagram scrapes for 24 hours", async () => {
    setCalls.length = 0;
    await withScrapeCache("instagram", "someone", async () => "result");
    expect(setCalls[0].opts).toEqual({ ex: 24 * 60 * 60 });
  });
});
