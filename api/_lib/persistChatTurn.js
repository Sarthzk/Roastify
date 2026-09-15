import { getSupabaseAdminClient, isSupabaseConfigured } from "./supabaseAdmin.js";
import { reportError } from "./sentry.js";

// Persists both halves of one chat turn (the user's message and the model's reply) via
// the service role key — same reasoning as persistRoast.js: by the time this runs the
// client has already received the streamed reply over SSE, so a write failure here must
// never take that away. Fails open (returns null, never throws) and reports the failure
// (a plain Supabase/network error, not a RoastError, so reportError() always sends it —
// see api/_lib/errors.js) rather than silently losing a chat turn the way persistRoast
// itself once did before PERSIST_ROAST_FAILURE existed.
export async function persistChatTurn({ conversationId, userContent, assistantContent }) {
  if (!isSupabaseConfigured()) return null;

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("messages")
      .insert([
        { conversation_id: conversationId, role: "user", content: userContent },
        { conversation_id: conversationId, role: "assistant", content: assistantContent },
      ])
      .select("id, role");

    if (error) {
      console.error("Failed to persist chat turn:", error.message);
      reportError(error, { code: "PERSIST_CHAT_TURN_FAILURE" });
      return null;
    }

    return {
      userMessageId: data.find((message) => message.role === "user")?.id ?? null,
      assistantMessageId: data.find((message) => message.role === "assistant")?.id ?? null,
    };
  } catch (err) {
    console.error("Failed to persist chat turn:", err.message);
    reportError(err, { code: "PERSIST_CHAT_TURN_FAILURE" });
    return null;
  }
}
