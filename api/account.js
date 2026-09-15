import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser } from "./_lib/auth.js";
import { getSupabaseAdminClient } from "./_lib/supabaseAdmin.js";
import { reportError } from "./_lib/sentry.js";

// DELETE removes the signed-in caller's own account — never anyone else's: `user.id`
// comes from the verified JWT (api/_lib/auth.js), not from anything client-sent. Deletes
// via the service role key because deleting an auth.users row isn't something RLS/the
// anon key can do at all; the roasts table's `user_id` foreign key is
// `on delete cascade` (see supabase/migrations/), so every roast attached to this account
// is removed by Postgres itself as part of the same operation, not a second manual step
// here that could fail out of sync with the account deletion.
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthenticatedUser(req);
  if (!user) {
    const err = new RoastError(ERROR_CODES.SIGN_IN_REQUIRED, "Sign in to manage your account.", {
      status: 401,
      retryable: false,
    });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { error } = await getSupabaseAdminClient().auth.admin.deleteUser(user.id);

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to delete account.", { status: 500, cause: error });
    console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: error.message }));
    reportError(err, { code: err.code });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ ok: true });
}
