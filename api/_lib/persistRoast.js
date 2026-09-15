import { getSupabaseAdminClient, isSupabaseConfigured } from "./supabaseAdmin.js";
import { reportError } from "./sentry.js";

// GitHub/Instagram profiles are already public and low-PII, so storing the scraped text
// alongside the roast (so chat can reference it — see api/messages.js) is fine. LinkedIn
// and resume come from an uploaded document — full name, employer, sometimes phone/
// address — and the privacy page promises "uploaded files are never stored. The PDF
// stays in your browser." That promise has to stay true, so those two types never get a
// profile_data value, no matter what a caller passes. This set is the one place that
// distinction is enforced at the persistence layer itself, not just by api/roast.js
// being careful about what it passes — a future change to the caller can't quietly start
// storing linkedin/resume text by accident. (The `roasts_profile_data_type_check`
// constraint in the migration is the same guarantee again, at the schema level — belt and
// suspenders.)
const STORABLE_PROFILE_DATA_TYPES = new Set(["github", "instagram"]);

// How long stored profile data stays usable for chat before it's treated as expired
// (api/messages.js falls back to roast-only context, not an error) and eligible for the
// purge cron (api/cron/purge-expired-profile-data.js) to actually delete it. 30 days is a
// starting guess, not a tuned value — export it so the one place that computes the expiry
// timestamp is also the one place that number lives.
export const PROFILE_DATA_RETENTION_DAYS = 30;

// Persists a completed roast via the service role key (bypassing RLS deliberately — this
// is the only writer roasts ever gets; see the migration's comment on why there's no
// INSERT policy for anon/authenticated). userId is always the server-verified id from
// getAuthenticatedUser(), never anything client-sent. Anonymous roasts are still stored
// (user_id null) for analytics, just not attributed — see CLAUDE.md's "Auth" section.
// A no-op when Supabase isn't configured, and fails open on any write error — persistence
// is a product feature, not a correctness requirement for the roast the caller already
// received. Fail-open here is deliberate, but it already broke silently once before
// anybody noticed — PERSIST_ROAST_FAILURE is a distinct code specifically so this
// particular failure is never invisible again. Only the error message goes to Sentry,
// never `roast`/`tips`/`identifier`/`profileData` (the actual roast/profile content this
// call carries).
export async function persistRoast({ userId, type, identifier, persona, severity, model, roast, tips, profileData }) {
  if (!isSupabaseConfigured()) return;

  const storableProfileData = STORABLE_PROFILE_DATA_TYPES.has(type) && profileData ? profileData : null;
  const profileDataExpiresAt = storableProfileData
    ? new Date(Date.now() + PROFILE_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  try {
    const { error } = await getSupabaseAdminClient()
      .from("roasts")
      .insert({
        user_id: userId,
        type,
        identifier,
        persona,
        severity,
        model,
        roast,
        tips,
        profile_data: storableProfileData,
        profile_data_expires_at: profileDataExpiresAt,
      });
    if (error) {
      console.error("Failed to persist roast:", error.message);
      reportError(error, { code: "PERSIST_ROAST_FAILURE", type });
    }
  } catch (err) {
    console.error("Failed to persist roast:", err.message);
    reportError(err, { code: "PERSIST_ROAST_FAILURE", type });
  }
}
