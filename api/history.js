import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser, extractBearerToken } from "./_lib/auth.js";
import { getSupabaseClientForUser } from "./_lib/supabaseUser.js";

const PAGE_SIZE = 25;

function getCursor(req) {
  // req.url is a path+query string (no host) both on Vercel and in index.js's local
  // shim — the dummy base is only there because URL() requires one.
  return new URL(req.url, "http://x").searchParams.get("cursor");
}

// Returns the signed-in caller's own past roasts, newest first, paginated 25 at a time
// via a `cursor` (an ISO created_at timestamp — pass the last row's `created_at` to get
// the next page). Queries through a per-request client scoped to the caller's own JWT
// (api/_lib/supabaseUser.js) rather than the service-role admin client, so it's Postgres
// RLS — the "read own roasts" policy in supabase/migrations/ — that actually restricts
// the result to this caller's rows, not application code alone.
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthenticatedUser(req);
  if (!user) {
    const err = new RoastError(ERROR_CODES.SIGN_IN_REQUIRED, "Sign in to see your roast history.", {
      status: 401,
      retryable: false,
    });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // getAuthenticatedUser() having returned a user already proves Supabase is configured
  // and this request carries a valid token, so extractBearerToken(req) and
  // getSupabaseClientForUser() can't fail here.
  const client = getSupabaseClientForUser(extractBearerToken(req));

  let query = client
    .from("roasts")
    .select("id, type, identifier, persona, severity, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const cursor = getCursor(req);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load history.", { status: 500, cause: error });
    console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: error.message }));
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ roasts: data, nextCursor: data.length === PAGE_SIZE ? data[data.length - 1].created_at : null });
}
