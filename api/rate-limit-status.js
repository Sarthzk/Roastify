import { getClientIP, createRatelimit, RATE_LIMIT_MAX } from "./_lib/rateLimit.js";
import { handleCorsPreflight } from "./_lib/cors.js";

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const ip = getClientIP(req);

  try {
    const ratelimit = createRatelimit();
    const { limit, remaining, reset } = await ratelimit.getRemaining(ip);
    res.json({ limit, remaining, reset });
  } catch (err) {
    console.error("Rate limit status check failed:", err.message);
    // Fail open with an optimistic status so the UI doesn't break if Upstash is unavailable
    res.json({ limit: RATE_LIMIT_MAX, remaining: RATE_LIMIT_MAX, reset: null, unavailable: true });
  }
}
