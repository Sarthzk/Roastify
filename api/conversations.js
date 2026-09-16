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

const LIST_PAGE_SIZE = 25;

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

// Lists the caller's own conversations, newest first, paginated 25 at a time via a
// `cursor` (an ISO created_at timestamp — same convention as api/history.js's own list).
// Each row needs two things the conversations table alone doesn't carry: the roast's
// `type` (for the "persona · source" kicker the chat list shows) and the conversation's
// most recent message (for the row's primary line, with a "you:" prefix when it's the
// caller's own). Both are fetched as separate follow-up queries, awaited sequentially —
// same style every other query in this file already uses — rather than one nested query
// (an embedded per-relation order+limit is real PostgREST/supabase-js functionality, but
// there's no live project here to verify the nested syntax against) or Promise.all (a
// full page tops out at 25 conversations, each a single indexed lookup on
// messages_conversation_id_idx, so sequential awaits stay fast without the extra
// complexity of parallel error-handling).
async function handleList(req, res, client) {
  let query = client
    .from("conversations")
    .select("id, roast_id, persona, created_at")
    .order("created_at", { ascending: false })
    .limit(LIST_PAGE_SIZE);

  const cursor = getQueryParams(req).get("cursor");
  if (cursor) query = query.lt("created_at", cursor);

  const { data: conversations, error: conversationsError } = await query;

  if (conversationsError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load your conversations.", {
      status: 500,
      cause: conversationsError,
    });
    logDbFailure(err, conversationsError);
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  if (conversations.length === 0) {
    return res.json({ conversations: [], nextCursor: null });
  }

  const roastIds = [...new Set(conversations.map((c) => c.roast_id).filter(Boolean))];
  let typeByRoastId = new Map();

  if (roastIds.length > 0) {
    const { data: roasts, error: roastsError } = await client.from("roasts").select("id, type").in("id", roastIds);

    if (roastsError) {
      const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load your conversations.", {
        status: 500,
        cause: roastsError,
      });
      logDbFailure(err, roastsError);
      return res.status(err.status).json(toErrorEnvelope(err));
    }

    typeByRoastId = new Map(roasts.map((r) => [r.id, r.type]));
  }

  const rows = [];
  for (const c of conversations) {
    const { data: lastMessages, error: lastMessageError } = await client
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastMessageError) {
      const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load your conversations.", {
        status: 500,
        cause: lastMessageError,
      });
      logDbFailure(err, lastMessageError);
      return res.status(err.status).json(toErrorEnvelope(err));
    }

    const lastMessage = lastMessages[0];
    rows.push({
      ...toConversationPayload(c),
      type: typeByRoastId.get(c.roast_id) ?? null,
      lastMessage: lastMessage
        ? { role: lastMessage.role, content: lastMessage.content, createdAt: lastMessage.created_at }
        : null,
    });
  }

  res.json({
    conversations: rows,
    nextCursor: conversations.length === LIST_PAGE_SIZE ? conversations[conversations.length - 1].created_at : null,
  });
}

// Fetches one conversation with all of its messages, oldest first, plus the roast that
// started it — the UI needs the actual roast/tips text to keep it "visible or easily
// recallable" alongside the conversation (see CLAUDE.md's "Chat" section), not just the
// roastId a client would otherwise have to go re-fetch some other way. Queried via the
// caller's own scoped client (RLS "read own" on both tables — messages has no user_id
// column of its own, so its policy joins back to conversations.user_id), so a
// conversation id that doesn't exist or belongs to someone else looks identical: a 0-row
// match, surfaced as CONVERSATION_NOT_FOUND either way.
async function handleGet(req, res, client) {
  const id = getQueryParams(req).get("id");
  if (!id) return handleList(req, res, client);

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

  // roast_id is nullable for a future debate-mode conversation with no roast attached
  // (see the migration) — not reachable today (every conversation is created from a
  // roastId, see handleStart above), but guarded rather than assumed.
  let roast = null;
  if (conversation.roast_id) {
    const { data: roastRow, error: roastError } = await client
      .from("roasts")
      .select("type, identifier, severity, roast, tips")
      .eq("id", conversation.roast_id)
      .maybeSingle();

    if (roastError) {
      const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load the roast behind this conversation.", {
        status: 500,
        cause: roastError,
      });
      logDbFailure(err, roastError);
      return res.status(err.status).json(toErrorEnvelope(err));
    }

    if (roastRow) {
      roast = {
        type: roastRow.type,
        identifier: roastRow.identifier,
        severity: roastRow.severity,
        roast: roastRow.roast,
        tips: roastRow.tips,
      };
    }
  }

  res.json({
    ...toConversationPayload(conversation),
    roast,
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

// POST starts a conversation from a roast id. GET ?id= fetches one conversation with its
// messages; GET with no id lists the caller's own conversations, newest first (see
// handleList). DELETE removes one. All signed-in only — anonymous gets SIGN_IN_REQUIRED,
// same code/semantics api/history.js already uses for "sign in for this." See
// api/messages.js for posting an actual chat message (a separate endpoint — this file
// never talks to the model).
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
