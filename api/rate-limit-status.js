import { getClientIP, createRatelimit, getRateLimitKey, RATE_LIMIT_TIERS } from "./_lib/rateLimit.js";
import { handleCorsPreflight } from "./_lib/cors.js";
import { isInstagramEnabled } from "./_lib/config.js";
import { getAuthenticatedUser } from "./_lib/auth.js";
import { reportError } from "./_lib/sentry.js";

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // The frontend calls this endpoint on page load anyway, so the Instagram kill switch
  // rides along here instead of needing its own endpoint for one boolean.
  const instagramEnabled = isInstagramEnabled();

  // `signedIn` lets the UI distinguish the two different reasons Instagram might be
  // unavailable to a given caller: the global kill switch (instagramEnabled: false) vs.
  // this specific caller not being signed in (signedIn: false) — see api/roast.js's
  // SIGN_IN_REQUIRED gate, which enforces the same thing server-side regardless of what
  // this status endpoint reports.
  const user = await getAuthenticatedUser(req);
  const signedIn = Boolean(user);
  const tier = signedIn ? "authenticated" : "anonymous";

  // Dev-only bypass, mirroring api/roast.js's skip of the same Upstash check — the UI
  // shouldn't display a stale/fake count against a limit that isn't actually being
  // enforced. `limit`/`remaining`/`reset` stay null (not a fabricated number) with
  // `unlimited: true` marking why.
  if (process.env.NODE_ENV === "development") {
    return res.json({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled, signedIn, tier });
  }

  const ip = getClientIP(req);

  try {
    const ratelimit = createRatelimit(tier);
    const { limit, remaining, reset } = await ratelimit.getRemaining(getRateLimitKey(user, ip));
    res.json({ limit, remaining, reset, instagramEnabled, signedIn, tier });
  } catch (err) {
    console.error("Rate limit status check failed:", err.message);
    reportError(err, { code: "RATE_LIMIT_STATUS_FAILURE" });
    // Fail open with an optimistic status so the UI doesn't break if Upstash is unavailable
    const max = RATE_LIMIT_TIERS[tier].max;
    res.json({ limit: max, remaining: max, reset: null, unavailable: true, instagramEnabled, signedIn, tier });
  }
}
