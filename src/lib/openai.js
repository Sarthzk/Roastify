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

// `/api/roast` scrape failures respond with a plain JSON fallback; once scraping succeeds
// it switches to an SSE stream — a "roast" event per text chunk as it's generated, followed
// by one "complete" event with the final { roast, tips, modelUsed, rateLimit }. EventSource
// can't be used here since it only supports GET, so the stream is parsed by hand.
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
      }
    }
  }

  if (!result) {
    throw new Error("Roast stream ended without a result");
  }

  return result;
}

export async function getRoast(url, type, severity = "medium", model = "gpt-4o", { onRoastChunk } = {}) {
  const res = await fetch("/api/roast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, type, severity, model })
  });

  if ((res.headers.get("Content-Type") || "").includes("text/event-stream")) {
    return consumeRoastStream(res, onRoastChunk);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(data?.error || `Failed to fetch roast: ${res.statusText}`);
    error.status = res.status;
    error.rateLimit = data?.rateLimit ?? null;
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