// Parses one `event:`/`data:` pair out of a raw SSE record (the text between two "\n\n"
// separators). Returns null for anything that doesn't look like a well-formed event.
function parseSseRecord(rawEvent) {
  const eventMatch = rawEvent.match(/^event:\s*(.+)$/m);
  const dataMatch = rawEvent.match(/^data:\s*(.+)$/m);
  if (!eventMatch || !dataMatch) return null;

  try {
    return { event: eventMatch[1].trim(), data: JSON.parse(dataMatch[1]) };
  } catch {
    return null;
  }
}

// Builds an Error from the { error: { code, message, retryable } } envelope shared with
// the backend (api/_lib/errors.js) — used for both plain JSON error responses and SSE
// `error` frames, so both paths produce an Error with the same shape for callers to catch.
function errorFromEnvelope(envelope, rateLimit, fallbackMessage = "Something went wrong.") {
  const error = new Error(envelope?.message || fallbackMessage);
  error.code = envelope?.code ?? null;
  error.retryable = envelope?.retryable ?? false;
  error.rateLimit = rateLimit ?? null;
  return error;
}

// Shared by both `/api/roast` and `/api/messages`: each streams a text chunk event as
// it's generated (event name differs — "roast" vs. "message" — everything else about the
// shape is identical), then either one "complete" event with the final result or one
// "error" event (envelope, no canned fallback) if something failed after streaming had
// already started. EventSource can't be used for either since it only supports GET, so
// the stream is parsed by hand.
async function consumeSseStream(res, chunkEventName, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const parsed = parseSseRecord(rawEvent);
      if (!parsed) continue;

      if (parsed.event === chunkEventName) {
        onChunk?.(parsed.data.text);
      } else if (parsed.event === "complete") {
        result = parsed.data;
      } else if (parsed.event === "error") {
        throw errorFromEnvelope(parsed.data?.error, parsed.data?.rateLimit);
      }
    }
  }

  if (!result) {
    throw new Error("Stream ended without a result");
  }

  return result;
}

// `accessToken`, when present, is the current Supabase session's JWT — sent as a Bearer
// token so the server can derive the caller's identity itself (api/_lib/auth.js). Never
// sent as a user id in the request body; the server never trusts one.
function authHeaders(accessToken) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function getRoast(url, type, severity = "medium", model, persona, { onRoastChunk, accessToken } = {}) {
  // No default for `model` — a caller that explicitly passes `undefined` (production,
  // where the picker is hidden) must get a request with no `model` field at all, not
  // one silently re-filled with a default. The server pins the model regardless; this
  // is just about not sending a field there's no UI for. `persona`, unlike `model`, is
  // always sent when provided — it's a real production feature, not a dev-only toggle.
  const body = { url, type, severity };
  if (model) body.model = model;
  if (persona) body.persona = persona;

  const res = await fetch("/api/roast", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify(body)
  });

  if ((res.headers.get("Content-Type") || "").includes("text/event-stream")) {
    return consumeSseStream(res, "roast", onRoastChunk);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, data?.rateLimit, `Failed to fetch roast: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

export async function getRateLimitStatus(accessToken) {
  const res = await fetch("/api/rate-limit-status", { headers: authHeaders(accessToken) });

  if (!res.ok) {
    throw new Error(`Failed to fetch rate limit status: ${res.statusText}`);
  }

  return res.json();
}

// `cursor` is the previous page's `nextCursor` (an ISO created_at timestamp) — omit for
// the first page. `filters` (`{ persona, type, q }`, all optional) are real server-side
// filters (api/history.js), not client-side — passing one searches/narrows the caller's
// entire history, not just whatever page is already loaded. Throws the same
// envelope-derived Error as getRoast on a non-2xx response (SIGN_IN_REQUIRED when
// signed out or the token's expired, mainly).
export async function getHistory(accessToken, cursor, filters = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (filters.persona) params.set("persona", filters.persona);
  if (filters.type) params.set("type", filters.type);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  const res = await fetch(`/api/history${query ? `?${query}` : ""}`, { headers: authHeaders(accessToken) });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to fetch history: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Hard-deletes one of the caller's own roasts. `id` only says which row; the server never
// trusts it for *whose* row — see api/history.js's handleDelete, backed by Postgres RLS.
export async function deleteRoast(accessToken, id) {
  const res = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to delete roast: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Permanently deletes the caller's own account and every roast attached to it (see
// api/account.js) — irreversible, so the caller (src/routes/Privacy.jsx) gates this
// behind its own explicit confirmation step before ever calling it.
export async function deleteAccount(accessToken) {
  const res = await fetch("/api/account", {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to delete account: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Starts a conversation from an existing roast — the server copies that roast's persona
// onto the conversation and locks it there (api/conversations.js); there is no persona
// field here for a client to send. Throws the same envelope-derived Error as getRoast —
// ROAST_NOT_FOUND when roastId doesn't exist or isn't the caller's own.
export async function startConversation(accessToken, roastId) {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({ roastId }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to start this conversation: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// `cursor` is the previous page's `nextCursor` (an ISO created_at timestamp) — omit for
// the first page. Same shape/pagination convention as getHistory.
export async function getConversations(accessToken, cursor) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/conversations${params}`, { headers: authHeaders(accessToken) });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to fetch conversations: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Fetches one conversation with all of its messages, oldest first. CONVERSATION_NOT_FOUND
// covers both a genuinely missing id and one that belongs to someone else — deliberately
// indistinguishable, see api/conversations.js.
export async function getConversation(accessToken, id) {
  const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { headers: authHeaders(accessToken) });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to fetch this conversation: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Hard-deletes one of the caller's own conversations (messages cascade server-side). `id`
// only says which row; the server never trusts it for whose row — see
// api/conversations.js, backed by Postgres RLS, same pattern as deleteRoast.
export async function deleteConversation(accessToken, id) {
  const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, null, `Failed to delete this conversation: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}

// Posts one message into an existing conversation and streams the reply — same
// stream-or-status-code shape as getRoast (api/messages.js commits to SSE only once the
// model call is accepted; a failure before that is a plain JSON envelope), reusing the
// same consumeSseStream loop with "message" as the chunk event name instead of "roast".
// There is no persona field to send here either — see startConversation above.
export async function sendChatMessage(accessToken, conversationId, content, { onChunk } = {}) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({ conversationId, content }),
  });

  if ((res.headers.get("Content-Type") || "").includes("text/event-stream")) {
    return consumeSseStream(res, "message", onChunk);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = errorFromEnvelope(data?.error, data?.rateLimit, `Failed to send message: ${res.statusText}`);
    error.status = res.status;
    throw error;
  }

  return data;
}