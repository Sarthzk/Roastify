import { getClientIP, createRatelimit, getRateLimitKey } from "./_lib/rateLimit.js";
import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getAuthenticatedUser, extractBearerToken } from "./_lib/auth.js";
import { getSupabaseClientForUser } from "./_lib/supabaseUser.js";
import { getChatSystemPrompt } from "./_lib/prompts/chat.js";
import { getRequiredApiKey, getClient } from "./_lib/modelClient.js";
import { resolveModelOption, DEFAULT_MODEL_KEY, MAX_INPUT_LENGTH } from "./roast.js";
import { persistChatTurn } from "./_lib/persistChatTurn.js";
import { sendSseEvent } from "./_lib/streaming.js";
import { reportError } from "./_lib/sentry.js";

// How much prior conversation gets sent back to the model as context, on top of the new
// message itself (which is always included — trimming that away would defeat the
// request). 20 is a starting guess, not a tuned value: enough for a real back-and-forth
// without the token cost growing unbounded as a conversation gets long. Summarising
// older history instead of just dropping it is a later task — not built here.
export const CHAT_CONTEXT_MESSAGE_LIMIT = 20;

// Same cost/abuse-control reasoning as MAX_INPUT_LENGTH in api/roast.js, applied to one
// chat message instead of a whole scraped profile.
const MAX_MESSAGE_LENGTH = 4000;

// No response_format toggling here (unlike buildCompletionParams in api/roast.js) — chat
// replies are plain conversational text, not the { roast, tips } JSON contract, so
// there's no json_object mode to fight Groq's server-side buffering (see that function's
// own comment): real token-by-token streaming just works. reasoning_effort stays, for
// the same latency/cost reasons it exists there.
function buildChatCompletionParams(modelOption, systemPrompt, historyMessages) {
  const params = {
    model: modelOption.model,
    stream: true,
    messages: [{ role: "system", content: systemPrompt }, ...historyMessages],
  };
  if (modelOption.provider === "groq") {
    params.reasoning_effort = "low";
  }
  return params;
}

function logFailure(err, { conversationId, model } = {}) {
  const code = err instanceof RoastError ? err.code : ERROR_CODES.INTERNAL_ERROR;
  const payload = { code, conversationId, model, message: err.message };
  if (err.cause?.message) payload.causeMessage = err.cause.message;
  console.error(JSON.stringify(payload));
  reportError(err, { code, conversationId, model });
}

// Posts one message into an existing conversation and streams the reply over SSE — the
// same commit-to-SSE-only-after-the-stream-promise-resolves pattern api/roast.js uses
// (see its "Streaming" comment): a failure before that point is a real HTTP status, a
// failure after is an `event: error` frame, using the same envelope shape either way.
// Signed-in only; the persona is never read from the request body, only from the
// conversation row (locked at creation — see api/conversations.js), so a client-supplied
// persona has nothing to attach to.
export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthenticatedUser(req);
  if (!user) {
    const err = new RoastError(ERROR_CODES.SIGN_IN_REQUIRED, "Sign in to chat about your roast.", {
      status: 401,
      retryable: false,
    });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const conversationId = String(req.body?.conversationId || "").trim();
  const content = String(req.body?.content || "").trim();
  if (!conversationId || !content) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing conversationId or content.", { status: 400 });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const modelOption = resolveModelOption(DEFAULT_MODEL_KEY);
  const requiredApiKey = getRequiredApiKey(modelOption.provider);
  if (!requiredApiKey) {
    const err = new RoastError(
      ERROR_CODES.SERVER_MISCONFIGURED,
      `Server misconfigured: missing API key for ${modelOption.label}`,
      { status: 500 }
    );
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // Its own bucket, separate from roasts — a chat turn is much cheaper (no scrape), so
  // the cap is meaningfully higher (see RATE_LIMIT_TIERS.chat). Always keyed by user id:
  // this endpoint is signed-in only by this point, so the IP fallback in
  // getRateLimitKey() never actually triggers. Same NODE_ENV dev bypass as
  // api/roast.js's own rate-limit check.
  let rateLimitInfo = null;
  if (process.env.NODE_ENV !== "development") {
    try {
      const ratelimit = createRatelimit("chat");
      const { success, limit, remaining, reset } = await ratelimit.limit(getRateLimitKey(user, getClientIP(req)));
      rateLimitInfo = { limit, remaining, reset };
      if (!success) {
        const err = new RoastError(ERROR_CODES.RATE_LIMITED, "Too many messages. Try again later.", {
          status: 429,
          retryable: false,
        });
        return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
      }
    } catch (rateLimitError) {
      console.error("Chat rate limit init failed:", rateLimitError.message);
      reportError(rateLimitError, { code: "CHAT_RATE_LIMIT_INIT_FAILURE" });
      // Fail open — continue without rate limiting if Upstash is unavailable, same as
      // api/roast.js.
    }
  }

  // Scoped to the caller's own JWT — RLS ("conversations: read own") decides whether
  // this conversation belongs to them, so a wrong/foreign id and a genuinely missing one
  // both surface as the same CONVERSATION_NOT_FOUND.
  const client = getSupabaseClientForUser(extractBearerToken(req));

  const { data: conversation, error: conversationError } = await client
    .from("conversations")
    .select("id, persona, roast_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    const err = new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to load this conversation.", {
      status: 500,
      cause: conversationError,
    });
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  if (!conversation) {
    const err = new RoastError(ERROR_CODES.CONVERSATION_NOT_FOUND, "Conversation not found.", { status: 404 });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  if (!conversation.roast_id) {
    // Every conversation today comes from POST /api/conversations, which always
    // requires a roastId (see that handler) — a null roast_id is debate mode's future
    // shape, not something reachable yet. Fail honestly instead of guessing at a
    // roast-less system prompt nothing can test.
    const err = new RoastError(
      ERROR_CODES.INTERNAL_ERROR,
      "This conversation has no roast to chat about.",
      { status: 500 }
    );
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  const { data: roast, error: roastError } = await client
    .from("roasts")
    .select("roast, tips, profile_data, profile_data_expires_at")
    .eq("id", conversation.roast_id)
    .maybeSingle();

  if (roastError || !roast) {
    const err = new RoastError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to load the roast behind this conversation.",
      { status: 500, cause: roastError }
    );
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  // profile_data is only ever set for github/instagram roasts (persistRoast.js enforces
  // this at write time) and only for PROFILE_DATA_RETENTION_DAYS — an expired or never-
  // stored roast (linkedin, resume) falls back to roast-only context, not an error;
  // getChatSystemPrompt() picks the right base fragment for either case. Re-truncated to
  // MAX_INPUT_LENGTH here — it was already capped once at write time (see
  // persistRoast.js), this is defense in depth against that invariant ever drifting, and
  // reuses the exact same number rather than a second hardcoded one (see api/roast.js).
  const profileDataExpired =
    roast.profile_data_expires_at && new Date(roast.profile_data_expires_at).getTime() <= Date.now();
  const profileData =
    roast.profile_data && !profileDataExpired ? String(roast.profile_data).slice(0, MAX_INPUT_LENGTH) : null;

  const { data: history, error: historyError } = await client
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(CHAT_CONTEXT_MESSAGE_LIMIT);

  if (historyError) {
    const err = new RoastError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to load this conversation's history.",
      { status: 500, cause: historyError }
    );
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  const trimmedContent = content.slice(0, MAX_MESSAGE_LENGTH);
  // getChatSystemPrompt() always uses conversation.persona — the id this conversation
  // was locked to at creation, never anything from req.body — so there is no client-
  // supplied persona field for this endpoint to even read, let alone honor.
  const systemPrompt = getChatSystemPrompt(conversation.persona, roast.roast, roast.tips, profileData);
  const contextMessages = [
    ...history
      .slice()
      .reverse()
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: trimmedContent },
  ];

  let stream;
  try {
    stream = await getClient(modelOption).chat.completions.create(
      buildChatCompletionParams(modelOption, systemPrompt, contextMessages)
    );
  } catch (e) {
    const err = new RoastError(ERROR_CODES.LLM_UPSTREAM_FAILURE, "Failed to reach the chat model. Please try again.", {
      status: 502,
      retryable: true,
      cause: e,
    });
    logFailure(err, { conversationId, model: modelOption.model });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let buffer = "";
  try {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      buffer += delta;
      sendSseEvent(res, "message", { text: buffer });
    }

    if (!buffer) {
      throw new RoastError(ERROR_CODES.LLM_EMPTY_RESPONSE, "The chat model returned an empty response. Please try again.", {
        retryable: true,
      });
    }

    const persisted = await persistChatTurn({
      conversationId,
      userContent: trimmedContent,
      assistantContent: buffer,
    });

    sendSseEvent(res, "complete", {
      text: buffer,
      messageId: persisted?.assistantMessageId ?? null,
      rateLimit: rateLimitInfo,
    });
  } catch (e) {
    const err = e instanceof RoastError ? e : new RoastError(ERROR_CODES.LLM_UPSTREAM_FAILURE, "Something went wrong generating this reply.", {
      retryable: true,
      cause: e,
    });
    logFailure(err, { conversationId, model: modelOption.model });
    sendSseEvent(res, "error", { ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  } finally {
    res.end();
  }
}
