// Incrementally extracts the value of the "roast" key from a partial JSON string as it
// streams in from the model, without waiting for the whole `{ "roast": ..., "tips": [...] }`
// object to finish. Stops (without marking complete) the moment it runs out of buffer,
// including mid-escape-sequence, so it never emits garbage for a half-received escape.
export function extractStreamingRoastText(buffer) {
  const keyMatch = buffer.match(/"roast"\s*:\s*"/);
  if (!keyMatch) {
    return { text: "", complete: false };
  }

  const escapeMap = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f" };
  let i = keyMatch.index + keyMatch[0].length;
  let text = "";
  let complete = false;

  while (i < buffer.length) {
    const ch = buffer[i];

    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break; // incomplete escape — wait for more data

      if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) break; // incomplete unicode escape — wait for more data
        text += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else {
        text += escapeMap[next] ?? next;
        i += 2;
      }
      continue;
    }

    if (ch === '"') {
      complete = true;
      break;
    }

    text += ch;
    i += 1;
  }

  return { text, complete };
}

export function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
