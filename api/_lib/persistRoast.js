import { getSupabaseAdminClient, isSupabaseConfigured } from "./supabaseAdmin.js";

// Persists a completed roast via the service role key (bypassing RLS deliberately — this
// is the only writer roasts ever gets; see the migration's comment on why there's no
// INSERT policy for anon/authenticated). userId is always the server-verified id from
// getAuthenticatedUser(), never anything client-sent. Anonymous roasts are still stored
// (user_id null) for analytics, just not attributed — see CLAUDE.md's "Auth" section.
// A no-op when Supabase isn't configured, and fails open on any write error — persistence
// is a product feature, not a correctness requirement for the roast the caller already
// received.
export async function persistRoast({ userId, type, identifier, persona, severity, model, roast, tips }) {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await getSupabaseAdminClient()
      .from("roasts")
      .insert({ user_id: userId, type, identifier, persona, severity, model, roast, tips });
    if (error) console.error("Failed to persist roast:", error.message);
  } catch (err) {
    console.error("Failed to persist roast:", err.message);
  }
}
