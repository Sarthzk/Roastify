import { getSupabaseAdminClient, isSupabaseConfigured } from "./supabaseAdmin.js";
import { reportError } from "./sentry.js";

// Pulls the raw JWT out of `Authorization: Bearer <jwt>`, or null for a missing/
// malformed header or an empty token. Shared by getAuthenticatedUser() below and by
// api/history.js, which needs the raw token itself (not just the verified user) to build
// a per-request client that queries as the caller — see api/_lib/supabaseUser.js.
export function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

// Verifies the `Authorization: Bearer <jwt>` header against Supabase Auth and returns
// the user it actually belongs to — { id, email } — never a client-sent id. Returns null
// (treat the request as anonymous) for a missing/malformed header, an invalid or expired
// token, an unreachable Auth service, or when Supabase isn't configured at all (a fork,
// or local dev without a project — see CLAUDE.md's "the app must work fully when
// Supabase env vars are absent" requirement).
export async function getAuthenticatedUser(req) {
  if (!isSupabaseConfigured()) return null;

  const token = extractBearerToken(req);
  if (!token) return null;

  try {
    const { data, error } = await getSupabaseAdminClient().auth.getUser(token);
    if (error || !data?.user) {
      // A token was actually sent and Supabase rejected it (expired, malformed, wrong
      // project) — distinct from the no-token-at-all case above, which is just an
      // anonymous request and never reaches here. Worth a Sentry issue: at volume this is
      // the signal for a real problem (key rotation, clock skew, an outage) rather than
      // any single caller's stale session.
      const verificationError = new Error(error?.message || "Supabase returned no user for this token");
      console.error("JWT verification failed:", verificationError.message);
      reportError(verificationError, { code: "JWT_VERIFICATION_FAILURE" });
      return null;
    }
    return { id: data.user.id, email: data.user.email };
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    reportError(err, { code: "JWT_VERIFICATION_FAILURE" });
    return null;
  }
}
