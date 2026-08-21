// Shared between the backend (api/roast.js) and the frontend (src/lib/openai.js /
// src/App.jsx) — a single source of truth for the { error: { code, message, retryable } }
// envelope both JSON error responses and SSE `error` frames use. Zero dependencies, so
// it's safe for the browser bundle to import directly without dragging in server-only
// code (the OpenAI SDK, node builtins, etc).

export const ERROR_CODES = {
  MISSING_INPUT: "MISSING_INPUT",
  SERVER_MISCONFIGURED: "SERVER_MISCONFIGURED",
  RATE_LIMITED: "RATE_LIMITED",
  SCRAPE_NOT_FOUND: "SCRAPE_NOT_FOUND",
  SCRAPE_INVALID_INPUT: "SCRAPE_INVALID_INPUT",
  SCRAPE_UPSTREAM_FAILURE: "SCRAPE_UPSTREAM_FAILURE",
  SCRAPE_TIMEOUT: "SCRAPE_TIMEOUT",
  PERSONA_NOT_ALLOWED_FOR_TYPE: "PERSONA_NOT_ALLOWED_FOR_TYPE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  LLM_UPSTREAM_FAILURE: "LLM_UPSTREAM_FAILURE",
  LLM_EMPTY_RESPONSE: "LLM_EMPTY_RESPONSE",
  LLM_PARSE_FAILURE: "LLM_PARSE_FAILURE",
  LLM_INVALID_FORMAT: "LLM_INVALID_FORMAT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

// Thrown by scrapers/handler logic so the code/status/retryable travel with the error
// object itself instead of being pattern-matched from message text later (fragile, and
// breaks silently if a message ever gets reworded). `cause` (the standard Error option)
// carries the real underlying error for server-side logging without exposing it to the
// client — toErrorEnvelope() never reads `cause`.
export class RoastError extends Error {
  constructor(code, message, { status = 500, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RoastError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// The one envelope shape used for both JSON error responses and SSE `error` frames.
// Anything that isn't a RoastError (a genuine bug, not an anticipated failure mode) is
// deliberately reported generically here — its real message goes to the server log via
// logFailure(), never to the client.
export function toErrorEnvelope(err) {
  if (err instanceof RoastError) {
    return { error: { code: err.code, message: err.message, retryable: err.retryable } };
  }
  return { error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Something went wrong.", retryable: false } };
}
