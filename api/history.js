import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser, extractBearerToken } from "./_lib/auth.js";
import { getSupabaseClientForUser } from "./_lib/supabaseUser.js";
import { captureError } from "./_lib/sentry.js";

const PAGE_SIZE = 25;

function getQueryParams(req) {
  // req.url is a path+query string (no host) both on Vercel and in index.js's local
  // shim — the dummy base is only there because URL() requires one.
  return new URL(req.url, "http://x").searchParams;
}

// Deletes one roast, owner-only. `id` is the only client-supplied value here — which row,
// never whose row: the actual ownership check is Postgres RLS (the "roasts: delete own"
// policy in supabase/migrations/), enforced because `client` is scoped to the caller's own
// verified JWT, not the service-role admin client. A 0-row match (wrong id, or someone
// else's row) and a genuinely missing id both surface as the same 404 — never a hint about
// which, since that would leak whether an id exists at all.
async function handleDelete(req, res, client) {
  const id = getQueryParams(req).get("id");
  if (!id) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing roast id.", { status: 400 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { error, count } = await client.from("roasts").delete({ count: "exact" }).eq("id", id);

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to delete roast.", { status: 500, cause: error });
    console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: error.message }));
    captureError(err, { code: err.code });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  if (!count) {
    const err = new RoastError(ERROR_CODES.ROAST_NOT_FOUND, "Roast not found.", { status: 404 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ ok: true });
}

// GET returns the signed-in caller's own past roasts, newest first, paginated 25 at a time
// via a `cursor` (an ISO created_at timestamp — pass the last row's `created_at` to get
// the next page). DELETE removes one (see handleDelete above). Both query through a
// per-request client scoped to the caller's own JWT (api/_lib/supabaseUser.js) rather than
// the service-role admin client, so it's Postgres RLS that actually restricts which rows
// this caller can read or delete, not application code alone.
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "GET" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  if (req.method === "DELETE") return handleDelete(req, res, client);

  let query = client
    .from("roasts")
    .select("id, type, identifier, persona, severity, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const cursor = getQueryParams(req).get("cursor");
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load history.", { status: 500, cause: error });
    console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: error.message }));
    captureError(err, { code: err.code });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ roasts: data, nextCursor: data.length === PAGE_SIZE ? data[data.length - 1].created_at : null });
}
