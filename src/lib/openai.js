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

export async function getRoast(url, type, severity = "medium", model, persona, { onRoastChunk } = {}) {
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
    headers: { "Content-Type": "application/json" },
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

export async function getRateLimitStatus() {
  const res = await fetch("/api/rate-limit-status");

  if (!res.ok) {
    throw new Error(`Failed to fetch rate limit status: ${res.statusText}`);
  }

  return res.json();
}