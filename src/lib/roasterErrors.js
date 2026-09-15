// Pure logic pulled out of Roaster.jsx so it's independently testable (see
// Roaster.test.jsx) and so Roaster.jsx itself can stay a component-only export — mixing
// plain function exports into a component file breaks Vite Fast Refresh for it
// (react-refresh/only-export-components).

export function formatCountdown(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// Turns a thrown error (see src/lib/openai.js's errorFromEnvelope) into the message/
// detail/retryable shape the Output error state renders. `detail` is synthesized from
// real data only — never fabricated: a rate-limit error gets a real countdown from the
// error's own attached rateLimit snapshot; a scrape-family error names the source type
// that was checked (never the raw submitted text — could be pasted resume/profile
// content); everything else falls back to a plain machine code. `code` travels through
// too — RoastCard needs it to tell SIGN_IN_REQUIRED (an invitation, not a failure) apart
// from every other error.
export function describeError(err, { type }) {
  const codeSlug = (err.code || "unknown").toLowerCase();
  let detail;
  if (err.code === "RATE_LIMITED" && err.rateLimit?.reset) {
    detail = `rate limit reached · resets in ${formatCountdown(err.rateLimit.reset - Date.now())} · err_${codeSlug}`;
  } else if (err.code && err.code.startsWith("SCRAPE_")) {
    detail = `checked ${type} · err_${codeSlug}`;
  } else {
    detail = `err_${codeSlug}`;
  }
  return { code: err.code, message: err.message, detail, retryable: Boolean(err.retryable) };
}
