// Shared between the backend (api/roast.js) and the frontend (src/lib/openai.js /
// src/App.jsx) — a single source of truth for the { error: { code, message, retryable } }
// envelope both JSON error responses and SSE `error` frames use. Zero dependencies, so
// it's safe for the browser bundle to import directly without dragging in server-only
// code (the OpenAI SDK, node builtins, etc).

// Whether an error indicates a problem with OUR system (worth a Sentry issue) versus
// expected user input/behavior (a typo'd username, a private profile, a missed rate
// limit — real, but not a bug; keep it in the structured console log only). Declared per
// code, here, rather than checked against a list at each call site — so a new code is
// forced to state which kind it is (RoastError's constructor throws if a code is missing
// an entry) instead of silently defaulting one way or the other.
const ERROR_CODE_META = {
  MISSING_INPUT: { reportToSentry: false },
  SERVER_MISCONFIGURED: { reportToSentry: true },
  RATE_LIMITED: { reportToSentry: false },
  SCRAPE_NOT_FOUND: { reportToSentry: false },
  SCRAPE_INVALID_INPUT: { reportToSentry: false },
  SCRAPE_UPSTREAM_FAILURE: { reportToSentry: true },
  SCRAPE_TIMEOUT: { reportToSentry: true },
  PERSONA_NOT_ALLOWED_FOR_TYPE: { reportToSentry: false },
  SOURCE_UNAVAILABLE: { reportToSentry: false },
  SIGN_IN_REQUIRED: { reportToSentry: false },
  ROAST_NOT_FOUND: { reportToSentry: false },
  LLM_UPSTREAM_FAILURE: { reportToSentry: true },
  LLM_EMPTY_RESPONSE: { reportToSentry: true },
  LLM_PARSE_FAILURE: { reportToSentry: true },
  LLM_INVALID_FORMAT: { reportToSentry: true },
  INTERNAL_ERROR: { reportToSentry: true },
};

export const ERROR_CODES = Object.fromEntries(Object.keys(ERROR_CODE_META).map((code) => [code, code]));

// Thrown by scrapers/handler logic so the code/status/retryable travel with the error
// object itself instead of being pattern-matched from message text later (fragile, and
// breaks silently if a message ever gets reworded). `cause` (the standard Error option)
// carries the real underlying error for server-side logging without exposing it to the
// client — toErrorEnvelope() never reads `cause`.
export class RoastError extends Error {
  constructor(code, message, { status = 500, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    const meta = ERROR_CODE_META[code];
    if (!meta) {
      throw new Error(`RoastError: "${code}" has no entry in ERROR_CODE_META (api/_lib/errors.js) — add one declaring reportToSentry.`);
    }
    this.name = "RoastError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.reportToSentry = meta.reportToSentry;
  }
}

// Non-RoastError errors are unanticipated bugs by definition — every expected failure
// mode in this codebase throws a RoastError with a code that has already declared its
// reportToSentry value above — so those always report; a RoastError just reads its own.
export function shouldReportToSentry(err) {
  return err instanceof RoastError ? err.reportToSentry : true;
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
