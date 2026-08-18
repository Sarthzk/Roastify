# Roastify Work Log

A running log of changes made to this project in collaboration with Claude Code, newest
first. Companion to `ROASTIFY_TASKS.md` (the backlog) — this file records what was
actually done, when, and why. Updated after each work session.

---

## 2026-08-12

### Section 5: streamed roast output (SSE)
- `api/roast.js`: once scraping succeeds, the handler switches its response to SSE
  (`Content-Type: text/event-stream`) and calls the model with `stream: true`. New pure
  function `extractStreamingRoastText(buffer)` incrementally pulls the `"roast"` string
  value out of the still-incomplete `{ "roast": ..., "tips": [...] }` JSON buffer as
  chunks arrive — handles partial escape sequences (including a `\u` escape split across
  chunk boundaries) by just waiting for more data rather than emitting garbage. Each
  growth of the extracted text is sent as an `event: roast` SSE frame; `tips` isn't
  streamed incrementally — once the model finishes, the full buffer is `JSON.parse`d and
  everything (`roast`, `tips`, `modelUsed`, `rateLimit`, dev-only debug fields) ships in
  one final `event: complete` frame. Added 8 Vitest cases for the extractor (partial
  buffers, escaped quotes, unicode escapes, trailing incomplete escapes).
- Split the handler's single try/catch (scrape + LLM call together) into two: scrape
  failures still return a plain JSON fallback (same as before, since SSE headers aren't
  committed yet), but LLM failures now happen *after* streaming has started, so they
  can't downgrade to an HTTP error status — the canned fallback is sent as the
  `complete` event instead, indistinguishable to the client from a real completion.
- `src/lib/openai.js`: `getRoast()` now branches on response `Content-Type` — a JSON
  response is handled as before; an SSE response is parsed by hand via
  `res.body.getReader()` (`EventSource` only supports `GET`, so it can't be used for a
  `POST`-triggered stream), invoking a new `onRoastChunk` callback per `roast` frame and
  resolving with the `complete` frame's data.
- `src/App.jsx`: `handleSubmit` passes an `onRoastChunk` that live-updates
  `result.roast` (keeping `tips: []` until the real completion), so `RoastCard` visibly
  fills in token-by-token while `loading` is still `true`.
- Verified for real: `curl -N` against `node index.js` showed genuine incremental
  `event: roast` frames growing character-by-character from GPT-4o, ending in one
  `event: complete` with the full parsed payload. Also drove it through an actual
  browser (installed Playwright + Chromium temporarily, per the user's choice when
  asked, then uninstalled both afterward — not a permanent dependency): screenshotted
  the roast card mid-stream showing text cut off mid-word ("...Linus Torval"), which is
  only possible if the DOM is genuinely updating live from arriving SSE frames, not
  rendering a pre-formed blob. No console errors. `npm test` (44/44), `npm run lint`,
  and `npm run build` all pass after `playwright` was removed again.
- Synced `ROASTIFY_TASKS.md` checkboxes to match reality for the first time — most of
  Sections 1-3's code-only items and the eval-harness half of Section 4 were already
  done in the 2026-08-11 session below but had never been ticked off.

---

## 2026-08-11

### Model switch: GPT-4o + Cohere Command A/R
- Decided on Cohere Command A / Command R (via OpenRouter) as the open-weight
  candidate, keeping GPT-4o available rather than cutting it over — added a UI
  toggle to pick the model per request instead of a hard swap.
- `api/roast.js`: added a `MODEL_OPTIONS` registry (`gpt-4o` → OpenAI, `command-a` /
  `command-r` → OpenRouter's OpenAI-compatible endpoint) and a pure, tested
  `resolveModelOption()` resolver (falls back to GPT-4o for an unknown/missing key,
  same pattern as `severity` validation). Verified the exact OpenRouter slugs
  (`cohere/command-a`, `cohere/command-r`) via web search before hardcoding them.
- Client construction split per provider (`getClient(modelOption)`), each with its own
  lazy key check — selecting a model whose provider key isn't configured now returns a
  clean `500 "Server misconfigured: missing API key for <model>"` instead of silently
  using the wrong model or crashing.
- Success responses now include `modelUsed` (the selected model's label); fallback/error
  responses deliberately don't, since no real model produced that canned text.
- Frontend: new "Model" picker in `InputForm.jsx` (mirrors the existing Severity
  picker's styling), wired through `App.jsx` state and `getRoast()` in
  `src/lib/openai.js`. `RoastCard.jsx` now shows which model generated the result next
  to "roast output".
- Added 5 unit tests for `resolveModelOption`. Updated `.env.example`, `README.md`,
  `CLAUDE.md` to document `OPENROUTER_API_KEY` as required for the Cohere options.
- Verified live: GPT-4o path works end-to-end with real keys; Command A correctly
  fails clean (missing `OPENROUTER_API_KEY`, not yet added); unknown model key falls
  back to GPT-4o.

### Local `.env` setup + a real bug fix
- Walked through which env vars are actually required vs optional
  (`OPENAI_API_KEY`, `APIFY_API_TOKEN`, `UPSTASH_REDIS_REST_URL` /
  `UPSTASH_REDIS_REST_TOKEN` required; `NODE_ENV` and `OPENROUTER_API_KEY` optional).
- **Found and fixed a real bug**: the project's hand-rolled `.env` loader (duplicated
  in `index.js` and `scripts/eval-models.mjs`) didn't strip surrounding quotes from
  values, unlike a real `dotenv` package would. The user's `UPSTASH_REDIS_REST_URL`
  was quoted in `.env`, so Redis calls were failing with a literal-quotes-in-URL error.
  Fixed both loaders to strip matching `'...'` / `"..."` quotes.
- Verified live end-to-end with real keys: GitHub scrape → OpenAI roast → Upstash rate
  limiting (decremented 5→4 correctly, reflected on `/api/rate-limit-status`).

### Section 4: OpenRouter model-eval harness
- `scripts/eval-fixtures.mjs` — 8 synthetic (fictional, not scraped) profile fixtures
  spanning all 4 profile types and a mix of severities, formatted to match exactly what
  each scraper produces in production.
- `scripts/eval-models.mjs` — standalone script (not part of the deployed app, never
  run in CI) that runs the real `getSystemPrompt()` from `api/roast.js` against all 8
  fixtures across `gpt-4o` (baseline) and OpenRouter candidates (Llama 3.3 70B,
  DeepSeek V3.2, Qwen3 235B — flagged that the Qwen slug should be reconfirmed, since
  OpenRouter versions it). Writes one Markdown file per fixture to
  `scripts/eval-output/` (gitignored) with every model's output side by side, plus a
  per-model JSON-parse-failure count.
- Exported `getSystemPrompt` from `api/roast.js` so the eval script reuses the exact
  production prompt logic instead of duplicating it.
- Verified the harness logic (success/broken-JSON/network-error handling, fixture
  loading) with a mocked client, since no `OPENROUTER_API_KEY` was available yet to
  run it for real.

### `CLAUDE.md` created
- Analyzed the codebase and wrote `CLAUDE.md` from scratch (commands, local dev
  two-process setup, architecture/request-flow walkthrough, rate limiting, frontend
  structure) — kept updated throughout the rest of the session as things changed.
- Confirmed there was no existing CLAUDE.md, Cursor rules, Copilot instructions, or
  Codex/Gemini config to import.

### Section 3 (Production readiness) — code-only subset
- **CORS**: `api/_lib/cors.js` restricts `Access-Control-Allow-Origin` to the
  production domain, handles `OPTIONS` preflight; applied to both `api/roast.js` and
  `api/rate-limit-status.js`.
- **`.env.example`**: documents all required/optional vars with links to get each one.
- **`npm audit fix`**: fixed 5/6 vulnerabilities non-breaking; left the `pdfjs-dist`
  fix (breaking major-version bump, used for resume PDF parsing) for explicit approval.
- **Retry-with-backoff**: new `api/_lib/fetchWithRetry.js`, applied to GitHub and Apify
  fetch calls (Apify's actor-start POST capped at 1 retry since it's non-idempotent and
  starts billed work).
- **Redis scrape caching**: new `api/_lib/scrapeCache.js`, 1-hour TTL keyed by
  `type:identifier`, wraps all three scrape calls, fails open on any Redis error.
- **Vitest**: 31 tests (at the time) for the pure parsing functions in `api/roast.js` —
  `extractGithubUsername`, `extractInstagramUsername`, `extractLinkedInSlug` (new),
  `extractPostCaptions`, `extractPostImageUrls`, `getField` (hoisted out of
  `scrapeLinkedIn`, where it had been unexported and untestable).
- **GitHub Actions CI**: `.github/workflows/ci.yml` runs lint, test, build on push/PR.
- **README**: added local setup steps, env var table, check commands.
- **Two bugs found and fixed while wiring this up**:
  1. The OpenAI client was constructed at module import time — a missing
     `OPENAI_API_KEY` crashed the whole process before the handler's own
     "server misconfigured" check could run. Moved to lazy construction inside the
     handler (also what made the module safely importable by Vitest).
  2. `index.js`'s local dev router matched by `{method, path}`, but Vercel doesn't gate
     by method at the routing layer — each function handles its own methods. This
     blocked OPTIONS preflight from ever reaching a handler locally. Fixed to match by
     path only.
- Deliberately left for the user (need external accounts or a business decision, not
  code): bot protection (Turnstile/hCaptcha), Sentry, uptime monitoring, OpenAI/Apify
  billing caps, the LinkedIn/Instagram scraping legal/compliance call.

---

## 2026-08-10

### Section 1: Critical fixes
- **Debug data leak**: `_debug_scraped_data` / `_debug_scraped_raw` in `/api/roast`
  responses gated behind `NODE_ENV === "development"` instead of always shipping the
  full raw scrape (possible PII) to every client.
- **Fallback roasts for every type**: added `defaultGithubResponse()`,
  `defaultLinkedInResponse()`, `defaultInstagramResponse()` (previously only `resume`
  had one), wired into the handler's catch block via a type→fallback lookup.
- **Input length cap**: scraped/pasted text truncated to `MAX_INPUT_LENGTH` (4000
  chars) right before the OpenAI call, to control token cost and prompt-injection
  surface.
- **LinkedIn/Instagram scrape timing**: cut the Apify poll budget from ~42s max
  (15 attempts × 3s) to ~18s (10 attempts × 2s), leaving more of the 60s
  `maxDuration` for the OpenAI call. Added a "still scraping the profile" notice in
  the UI (`App.jsx`) that appears after 5s for LinkedIn/Instagram requests, so a slow
  response doesn't look like a silent failure.

### Section 2: Quick UX wins
- **OG/Twitter meta tags** added to `index.html` for link previews. (Note: the
  `og:image` URL references `/og-image.png`, which doesn't exist yet — needs a real
  1200×630 image added.)
- **Real checkbox** in `RoastCard.jsx` — replaced the `<span onClick>` fake checkbox
  with an actual `<input type="checkbox">` (visually hidden, positioned over the
  existing styled decorative span) for keyboard/screen-reader accessibility, without
  changing how it looks.
- **`navigator.share()`** in `handleShare`, falling back to the existing
  clipboard-copy behavior when unsupported or cancelled.
- **Rate limit surfaced**: new non-consuming `GET /api/rate-limit-status` endpoint
  (`api/_lib/rateLimit.js` refactored to share Redis client setup); frontend fetches
  it on load and after every roast, showing `"X/5 roasts left this hour"` or a live
  countdown once the limit is hit, instead of only reacting to a bare 429.
