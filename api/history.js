import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser, extractBearerToken } from "./_lib/auth.js";
import { getSupabaseClientForUser } from "./_lib/supabaseUser.js";
import { reportError } from "./_lib/sentry.js";

const PAGE_SIZE = 25;

// Real backend counterparts of History.jsx's persona/source filter pills and search
// box — previously client-side only (filtering whatever page was already loaded).
// Neither `persona` nor `type` is validated against a known set here: an unrecognized
// value just matches zero rows, same as any other filter that happens not to match
// anything, so there's nothing meaningful to reject.

// Postgres ILIKE treats a bare "%"/"_" in the search text as a wildcard — escaping them
// (and the escape character itself) keeps a search for e.g. "50%" from silently turning
// into a pattern match instead of a literal one.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

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
    reportError(err, { code: err.code });
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

  // `roast`/`tips` are now selected too (previously omitted) so the History page can show
  // the real verdict quote and real fix chips per row, matching what RoastCard.jsx
  // already shows for a fresh roast — same stored data, just not read here before.
  let query = client
    .from("roasts")
    .select("id, type, identifier, persona, severity, roast, tips, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  const params = getQueryParams(req);
  const cursor = params.get("cursor");
  if (cursor) query = query.lt("created_at", cursor);

  // Real filters, applied server-side (History.jsx's filter pills/search box used to
  // only filter whatever page was already loaded on the client — this is the backend
  // for that, so it now searches/filters the caller's entire history, not just one page).
  const persona = params.get("persona");
  if (persona) query = query.eq("persona", persona);

  const type = params.get("type");
  if (type) query = query.eq("type", type);

  const q = params.get("q");
  if (q) query = query.ilike("identifier", `%${escapeLikePattern(q)}%`);

  const { data, error } = await query;

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load history.", { status: 500, cause: error });
    console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: error.message }));
    reportError(err, { code: err.code });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ roasts: data, nextCursor: data.length === PAGE_SIZE ? data[data.length - 1].created_at : null });
}
