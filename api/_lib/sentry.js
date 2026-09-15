import * as Sentry from "@sentry/node";
import { shouldReportToSentry } from "./errors.js";

// SENTRY_DSN is not set yet (no project has been created) — every call here must be a
// silent no-op until it is, never a crash or a warning. isSentryConfigured() gates
// everything below, same pattern as isSupabaseConfigured()/isInstagramEnabled().
export function isSentryConfigured() {
  return Boolean(process.env.SENTRY_DSN);
}

// Built lazily, once, the first time something actually needs to report — not at module
// load, so importing this file with no DSN set (the common case right now) never touches
// the network or spends startup time on a client nothing will use.
let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  // Same NODE_ENV convention as resolveProductionSafeModelOption/the rate-limit dev
  // bypass elsewhere in api/ — local dev sets NODE_ENV=development, so this is what
  // separates local noise from production issues in the Sentry dashboard.
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV === "development" ? "development" : "production",
  });
  initialized = true;
}

// Reports one error to Sentry, tagged with a machine code (and optionally type/model/
// persona — metadata, never content) for filtering in the Sentry UI. No-op when
// SENTRY_DSN is absent. Never pass anything here that could carry scraped profile
// content, resume text, roast text, or an email address — `err` itself must already be
// safe (every RoastError message in this codebase is a static, author-written string,
// never derived from user/profile content) and `tags` must stay metadata-only. This is
// exactly why logFailure() in api/roast.js builds its bufferPreview field for the console
// log but never passes it here.
export function captureError(err, tags = {}) {
  if (!isSentryConfigured()) return;
  ensureInitialized();
  Sentry.captureException(err, { tags });
}

// The entry point application code should actually call: reports err via captureError()
// above, but only when shouldReportToSentry(err) says it indicates a problem with our
// system rather than expected user input/behavior — see api/_lib/errors.js. Expected
// failures still get their existing structured console logging; this only gates the
// Sentry issue.
export function reportError(err, tags = {}) {
  if (!shouldReportToSentry(err)) return;
  captureError(err, tags);
}
