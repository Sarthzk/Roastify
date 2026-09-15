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

// `/api/roast` scrape/LLM-setup failures respond with a plain JSON error envelope; once
// the LLM call is accepted it switches to an SSE stream — a "roast" event per text chunk
// as it's generated, followed by either one "complete" event with the final
// { roast, tips, modelUsed, rateLimit } or one "error" event (envelope, no canned roast)
// if something failed after streaming had already started. EventSource can't be used
// here since it only supports GET, so the stream is parsed by hand.
async function consumeRoastStream(res, onRoastChunk) {
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

      if (parsed.event === "roast") {
        onRoastChunk?.(parsed.data.text);
      } else if (parsed.event === "complete") {
        result = parsed.data;
      } else if (parsed.event === "error") {
        throw errorFromEnvelope(parsed.data?.error, parsed.data?.rateLimit);
      }
    }
  }

  if (!result) {
    throw new Error("Roast stream ended without a result");
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
    return consumeRoastStream(res, onRoastChunk);
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
// the first page. Throws the same envelope-derived Error as getRoast on a non-2xx
// response (SIGN_IN_REQUIRED when signed out or the token's expired, mainly).
export async function getHistory(accessToken, cursor) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/history${params}`, { headers: authHeaders(accessToken) });

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