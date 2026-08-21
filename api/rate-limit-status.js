import { getClientIP, createRatelimit, RATE_LIMIT_MAX } from "./_lib/rateLimit.js";
import { handleCorsPreflight } from "./_lib/cors.js";
import { isInstagramEnabled } from "./_lib/config.js";

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // The frontend calls this endpoint on page load anyway, so the Instagram kill switch
  // rides along here instead of needing its own endpoint for one boolean.
  const instagramEnabled = isInstagramEnabled();

  // Dev-only bypass, mirroring api/roast.js's skip of the same Upstash check — the UI
  // shouldn't display a stale/fake count against a limit that isn't actually being
  // enforced. `limit`/`remaining`/`reset` stay null (not a fabricated number) with
  // `unlimited: true` marking why.
  if (process.env.NODE_ENV === "development") {
    return res.json({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled });
  }

  const ip = getClientIP(req);

  try {
    const ratelimit = createRatelimit();
    const { limit, remaining, reset } = await ratelimit.getRemaining(ip);
    res.json({ limit, remaining, reset, instagramEnabled });
  } catch (err) {
    console.error("Rate limit status check failed:", err.message);
    // Fail open with an optimistic status so the UI doesn't break if Upstash is unavailable
    res.json({ limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX, reset: null, unavailable: true, instagramEnabled });
  }
}
