import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser, extractBearerToken } from "./_lib/auth.js";
import { getSupabaseClientForUser } from "./_lib/supabaseUser.js";
import { getSupabaseAdminClient } from "./_lib/supabaseAdmin.js";
import { reportError } from "./_lib/sentry.js";

function getQueryParams(req) {
  // req.url is a path+query string (no host) both on Vercel and in index.js's local
  // shim — the dummy base is only there because URL() requires one.
  return new URL(req.url, "http://x").searchParams;
}

function logDbFailure(err, cause) {
  console.error(JSON.stringify({ code: err.code, message: err.message, causeMessage: cause?.message }));
  reportError(err, { code: err.code });
}

function toConversationPayload(row) {
  return { id: row.id, roastId: row.roast_id, persona: row.persona, createdAt: row.created_at };
}

// Starts a new conversation from an existing roast — the persona is copied from that
// roast row, never taken from the request body, so it's locked for the conversation's
// whole lifetime (api/messages.js always reads it back off the conversation, not from
// any client-sent field). Queries the roast via a client scoped to the caller's own JWT
// (api/_lib/supabaseUser.js), so it's Postgres RLS's "roasts: read own" policy — not
// application code — that actually decides whether this roast belongs to them; a 0-row
// match (wrong id, or someone else's roast) and a genuinely missing id both surface as
// the same ROAST_NOT_FOUND, deliberately indistinguishable, same pattern as
// api/history.js's delete.
async function handleStart(req, res, user, client) {
  const roastId = String(req.body?.roastId || "").trim();
  if (!roastId) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing roastId.", { status: 400 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { data: roast, error: roastError } = await client
    .from("roasts")
    .select("id, persona")
    .eq("id", roastId)
    .maybeSingle();

  if (roastError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to start this conversation.", {
      status: 500,
      cause: roastError,
    });
    logDbFailure(err, roastError);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  if (!roast) {
    const err = new RoastError(ERROR_CODES.ROAST_NOT_FOUND, "Roast not found.", { status: 404 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // Every write goes through the service role key (bypassing RLS deliberately — there is
  // no INSERT policy for the anon key on either table, same as roasts) — user_id always
  // comes from the verified JWT above, never from anything client-sent.
  const { data: conversation, error: insertError } = await getSupabaseAdminClient()
    .from("conversations")
    .insert({ user_id: user.id, roast_id: roast.id, persona: roast.persona })
    .select("id, roast_id, persona, created_at")
    .single();

  if (insertError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to start this conversation.", {
      status: 500,
      cause: insertError,
    });
    logDbFailure(err, insertError);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.status(201).json(toConversationPayload(conversation));
}

// Fetches one conversation with all of its messages, oldest first. Queried via the
// caller's own scoped client (RLS "read own" on both tables — messages has no user_id
// column of its own, so its policy joins back to conversations.user_id), so a
// conversation id that doesn't exist or belongs to someone else looks identical: a 0-row
// match, surfaced as CONVERSATION_NOT_FOUND either way.
async function handleGet(req, res, client) {
  const id = getQueryParams(req).get("id");
  if (!id) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing conversation id.", { status: 400 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { data: conversation, error: conversationError } = await client
    .from("conversations")
    .select("id, roast_id, persona, created_at")
    .eq("id", id)
    .maybeSingle();

  if (conversationError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load this conversation.", {
      status: 500,
      cause: conversationError,
    });
    logDbFailure(err, conversationError);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  if (!conversation) {
    const err = new RoastError(ERROR_CODES.CONVERSATION_NOT_FOUND, "Conversation not found.", { status: 404 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { data: messages, error: messagesError } = await client
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load this conversation's messages.", {
      status: 500,
      cause: messagesError,
    });
    logDbFailure(err, messagesError);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({
    ...toConversationPayload(conversation),
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at })),
  });
}

// Deletes one conversation, owner-only — `id` is the only client-supplied value here,
// never whose row: the ownership check is Postgres RLS ("conversations: delete own"),
// enforced because `client` is scoped to the caller's own verified JWT. messages cascade
// via the conversation_id foreign key (supabase/migrations/), not a second manual delete
// here. A 0-row match and a genuinely missing id both surface as the same 404.
async function handleDelete(req, res, client) {
  const id = getQueryParams(req).get("id");
  if (!id) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing conversation id.", { status: 400 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const { error, count } = await client.from("conversations").delete({ count: "exact" }).eq("id", id);

  if (error) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to delete this conversation.", {
      status: 500,
      cause: error,
    });
    logDbFailure(err, error);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  if (!count) {
    const err = new RoastError(ERROR_CODES.CONVERSATION_NOT_FOUND, "Conversation not found.", { status: 404 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  res.json({ ok: true });
}

// POST starts a conversation from a roast id. GET fetches one conversation with its
// messages. DELETE removes one. All three are signed-in only — anonymous gets
// SIGN_IN_REQUIRED, same code/semantics api/history.js already uses for "sign in for
// this." See api/messages.js for posting an actual chat message (a separate endpoint —
// this file never talks to the model).
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) {
    const err = new RoastError(ERROR_CODES.SIGN_IN_REQUIRED, "Sign in to chat about your roast.", {
      status: 401,
      retryable: false,
    });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // getAuthenticatedUser() having returned a user already proves Supabase is configured
  // and this request carries a valid token, so extractBearerToken(req) and
  // getSupabaseClientForUser() can't fail here — same reasoning as api/history.js.
  const client = getSupabaseClientForUser(extractBearerToken(req));

  if (req.method === "POST") return handleStart(req, res, user, client);
  if (req.method === "GET") return handleGet(req, res, client);
  return handleDelete(req, res, client);
}
