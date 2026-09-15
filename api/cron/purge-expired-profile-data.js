import { getSupabaseAdminClient, isSupabaseConfigured } from "../_lib/supabaseAdmin.js";
import { reportError } from "../_lib/sentry.js";

// The actual deletion half of profile-data retention — api/messages.js already treats
// expired profile data as absent at read time (falls back to roast-only chat context,
// never errors), independent of whether this has run yet; this is what keeps it from
// sitting in storage forever after that point. Runs on Vercel's Cron Jobs schedule (see
// the `crons` entry in vercel.json), which invokes this path directly rather than
// through any user session.
//
// Authenticated via CRON_SECRET (optional): when set, Vercel signs its own cron requests
// with `Authorization: Bearer <CRON_SECRET>` (the platform's documented pattern for this
// exact case), so any other caller is rejected. Left unset, this endpoint accepts any
// caller — acceptable because the query itself only ever touches rows that are already
// past their own expiry, so the worst an unauthenticated hit can do is purge data that
// was already due to go; it can never delete anything still within its retention window.
// Still, set CRON_SECRET in production so this endpoint isn't callable by just anyone.
export default async function handler(req, res) {
  // No CORS handling here (unlike every other handler under api/) — this is never called
  // from a browser, only by Vercel's own Cron Jobs scheduler or a curl test.
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isSupabaseConfigured()) {
    return res.status(200).json({ purged: 0, skipped: "supabase not configured" });
  }

  try {
    const { error, count } = await getSupabaseAdminClient()
      .from("roasts")
      .update({ profile_data: null, profile_data_expires_at: null }, { count: "exact" })
      .lt("profile_data_expires_at", new Date().toISOString());

    if (error) {
      console.error("Failed to purge expired profile data:", error.message);
      reportError(error, { code: "PURGE_EXPIRED_PROFILE_DATA_FAILURE" });
      return res.status(500).json({ error: "Purge failed" });
    }

    res.status(200).json({ purged: count ?? 0 });
  } catch (err) {
    console.error("Failed to purge expired profile data:", err.message);
    reportError(err, { code: "PURGE_EXPIRED_PROFILE_DATA_FAILURE" });
    res.status(500).json({ error: "Purge failed" });
  }
}
