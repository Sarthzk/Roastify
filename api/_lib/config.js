// Runtime feature flags read directly from process.env — small enough not to warrant a
// registry/resolver pattern like MODEL_OPTIONS or PERSONAS, just a couple of pure checks
// shared by the two callers that need them (api/roast.js and api/rate-limit-status.js).

// Instagram is the app's only remaining scraping dependency (LinkedIn moved to PDF upload).
// This lets it be disabled without a deploy if the Apify actor breaks — same boolean-string
// convention as NODE_ENV === "development" elsewhere in this codebase: only the literal
// string "false" disables it, so an unset or misconfigured var fails open to enabled.
export function isInstagramEnabled() {
  return process.env.INSTAGRAM_ENABLED !== "false";
}
