import { createRedisClient } from "./rateLimit.js";
import { reportError } from "./sentry.js";

// Instagram goes through Apify (a billed run per scrape) and profiles change slowly, so
// it's cached longer than GitHub, which is a free API and cheap to re-hit. LinkedIn has
// no entry — it's no longer scraped at all (PDF upload instead, see api/roast.js).
const CACHE_TTL_SECONDS = {
  github: 60 * 60, // 1 hour
  instagram: 24 * 60 * 60, // 24 hours
};
const DEFAULT_CACHE_TTL_SECONDS = 60 * 60;
const CACHE_PREFIX = "scrape";

function cacheKey(type, identifier) {
  return `${CACHE_PREFIX}:${type}:${String(identifier).toLowerCase()}`;
}

// Wraps a scrape call with a short-lived Redis cache keyed by type:identifier, so
// re-roasting the same profile at a different severity doesn't re-trigger a full
// Apify run. Fails open on any Redis error — caching is a cost optimization, not a
// correctness requirement, so a broken cache should never block a roast.
export async function withScrapeCache(type, identifier, fetcher) {
  const key = cacheKey(type, identifier);
  let redis = null;

  try {
    redis = createRedisClient();
    const cached = await redis.get(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  } catch (err) {
    console.error("Scrape cache read failed:", err.message);
    reportError(err, { code: "SCRAPE_CACHE_READ_FAILURE", type });
  }

  const result = await fetcher();

  if (redis) {
    try {
      await redis.set(key, result, { ex: CACHE_TTL_SECONDS[type] ?? DEFAULT_CACHE_TTL_SECONDS });
    } catch (err) {
      console.error("Scrape cache write failed:", err.message);
      reportError(err, { code: "SCRAPE_CACHE_WRITE_FAILURE", type });
    }
  }

  return result;
}
