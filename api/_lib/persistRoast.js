import { getSupabaseAdminClient, isSupabaseConfigured } from "./supabaseAdmin.js";
import { reportError } from "./sentry.js";

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
// never `roast`/`tips`/`identifier` (the actual roast/profile content this call carries).
export async function persistRoast({ userId, type, identifier, persona, severity, model, roast, tips }) {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await getSupabaseAdminClient()
      .from("roasts")
      .insert({ user_id: userId, type, identifier, persona, severity, model, roast, tips });
    if (error) {
      console.error("Failed to persist roast:", error.message);
      reportError(error, { code: "PERSIST_ROAST_FAILURE", type });
    }
  } catch (err) {
    console.error("Failed to persist roast:", err.message);
    reportError(err, { code: "PERSIST_ROAST_FAILURE", type });
  }
}
