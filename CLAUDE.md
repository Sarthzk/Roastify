# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm install       # install deps
npm run dev       # Vite dev server (frontend only)
npm run build     # production build (vite build)
npm run lint      # eslint . — see "Linting" note below, does NOT cover api/
npm test          # vitest run — pure parsing functions in api/roast.js (api/roast.test.js)
npm run preview   # preview a production build
```

Run a single test file/case with `npx vitest run api/roast.test.js -t "extractGithubUsername"`
(vitest's `-t` filters by test/describe name). `.github/workflows/ci.yml` runs lint, test, and
build on every push/PR to `main`.

### Running the API locally
`npm run dev` only starts the Vite frontend. The `/api/*` routes are Vercel serverless functions and
need a second process locally: `node index.js` (a minimal `http.createServer` shim on port 3001) —
`vite.config.js` proxies `/api` requests there. `index.js` keeps a small `routes` array mapping
*path* to a handler (method-agnostic, matching how Vercel actually invokes these functions — each
handler checks `req.method` itself); any new API route added under `api/` needs a path entry added
there too, or it won't be reachable via `npm run dev` (only via the deployed Vercel functions).

`index.js` loads a local `.env` file itself (no `dotenv` dependency, but does strip surrounding quotes
from values like real `dotenv` does) — required vars: `OPENAI_API_KEY` (or `VITE_OPENAI_API_KEY`),
`APIFY_API_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; add `OPENROUTER_API_KEY` too
if you want the Command A / Command R model options to work locally.

### Linting
`eslint.config.js` globally ignores `api/**` (and a nonexistent `roastify-backend/**`), so
`npm run lint` never lints anything under `api/` — including `api/roast.test.js`. Verify backend
changes with `node --check <file>` instead, or run `npx eslint <path> --no-ignore` if you
specifically want lint feedback there.

## Architecture

### Request flow (`api/roast.js`)
1. Frontend (`src/App.jsx`) collects `url`/`type`/`severity`/`model` via `InputForm`, calls
   `getRoast()` in `src/lib/openai.js`, which POSTs to `/api/roast`.
2. CORS preflight (`OPTIONS`) is handled first via `api/_lib/cors.js` — only the production origin
   (`https://roastify-two.vercel.app`, hardcoded in that file) is allowed.
3. Based on `type`, the handler scrapes the profile, wrapped in `withScrapeCache` (`api/_lib/scrapeCache.js`,
   1-hour Redis TTL keyed by `type:identifier`) so re-roasting the same profile at a different severity
   doesn't redo the scrape:
   - `github` → GitHub REST API directly, no auth token (subject to unauthenticated rate limits).
   - `linkedin` / `instagram` → Apify actors. Each tries a list of actor-name candidates in sequence
     (actor slugs get renamed/deprecated on Apify, so this is resilience against that), then polls
     the run status using `APIFY_POLL_MAX_ATTEMPTS` / `APIFY_POLL_INTERVAL_MS`.
   - `resume` → raw text passed through as-is (not cached); PDF/text extraction happens client-side
     in `InputForm.jsx` via `pdfjs-dist`, not on the server.
   All outbound `fetch` calls to GitHub/Apify go through `fetchWithRetry` (`api/_lib/fetchWithRetry.js`,
   exponential backoff on network errors and 429/5xx). The Apify actor-start POST is capped at 1 retry
   since it's non-idempotent (starts a billed run) — everything else uses more generous defaults.
4. The resulting text is truncated to `MAX_INPUT_LENGTH` (4000 chars) before being sent to the model.
5. **Model selection**: `MODEL_OPTIONS` in `api/roast.js` registers the models selectable from the UI —
   `gpt-4o` (OpenAI, default) alongside `command-a` / `command-r` (Cohere, routed through OpenRouter's
   OpenAI-compatible endpoint, `baseURL: "https://openrouter.ai/api/v1"`). `resolveModelOption(modelKey)`
   is a pure function (falls back to `DEFAULT_MODEL_KEY` for an unknown/missing key — same pattern as
   the `severity` validation) that both the handler and tests use; `getClient(modelOption)` lazily
   builds the right client (OpenAI vs OpenRouter creds) per request. GPT-4o is kept available
   alongside the OpenRouter candidates deliberately, for side-by-side dev/testing — see
   ROASTIFY_TASKS.md section 4. The selected model is called with a per-`type` system prompt from
   `getSystemPrompt()` — a fixed "Ricky Gervais roasting a Golden Globes profile" persona with
   Hinglish-flavored tips, tone adjusted by `severity` (`mild` / `medium` / `destroy me`). The model is
   forced to return `{ roast, tips }` JSON. Clients are built lazily (not at module load) specifically
   so a missing API key doesn't crash the process on import — it surfaces as a normal 500 from the
   handler's own key check instead, and the module stays importable by Vitest without needing any env
   vars set.
6. **Streaming**: once scraping succeeds, the response switches to SSE (`Content-Type:
   text/event-stream`) and the model is called with `stream: true` — the handler relays the roast
   text live as `event: roast` frames (`{ text }`, cumulative so far) while it arrives token-by-token,
   using `extractStreamingRoastText()` to pull the `"roast"` string value out of the still-incomplete
   `{ "roast": ..., "tips": [...] }` JSON buffer (handles partial/mid-escape-sequence buffers by just
   waiting for more data — see its tests in `api/roast.test.js`). `tips` isn't streamed incrementally;
   once the model finishes, the full buffer is `JSON.parse`d and everything (`roast`, `tips`,
   `modelUsed`, `rateLimit`, and the dev-only debug fields) ships in one final `event: complete` frame.
   Scrape failures (before any SSE headers are sent) are unaffected — those still return a plain JSON
   response, same as 429s and missing-API-key errors.
7. On any failure, the client still always gets a roast: scrape errors return a type-specific canned
   fallback (`defaultGithubResponse` / `defaultLinkedInResponse` / `defaultInstagramResponse` /
   `defaultResumeResponse`) as plain JSON (see point 6); LLM errors/malformed JSON happen *after* SSE
   headers are already committed, so they can't downgrade to an HTTP error status — the same fallback
   is instead sent as the `complete` event, indistinguishable to the client from a real completion.
   Fallbacks never carry a `modelUsed` field (no model actually produced that text).
8. Every response — success, 429, scrape-failure fallback, or streamed fallback — includes
   `rateLimit: { limit, remaining, reset }`. A successful (non-fallback) `complete` event also includes
   `modelUsed` (the selected model's display label), which `RoastCard.jsx` shows next to "roast
   output" — useful for comparing outputs while switching models.
9. `_debug_scraped_data` / `_debug_scraped_raw` (the raw scrape payload) are only attached to the
   `complete` event when `NODE_ENV === "development"`.

### Rate limiting & caching
`api/_lib/rateLimit.js` exports `createRedisClient()` (shared by rate limiting and scrape caching),
`getClientIP`, and `createRatelimit()` (`RATE_LIMIT_MAX = 5`, `RATE_LIMIT_WINDOW = "1 h"`, Upstash
Redis sliding window).
- `api/roast.js` consumes one token per request and fails open (logs and continues without limiting)
  if Upstash is unreachable.
- `api/rate-limit-status.js` is a separate, non-consuming `GET` endpoint (`ratelimit.getRemaining()`)
  that the frontend calls on page load so it can show remaining-roasts / cooldown state before the
  user ever submits, not just react to a 429 after the fact.
- `api/_lib/scrapeCache.js`'s `withScrapeCache` also fails open on any Redis error (read or write) —
  caching is a cost optimization, never a correctness requirement, so a broken cache must not block
  a roast.

### Frontend structure
- `src/App.jsx` — all top-level state (`url`, `type`, `severity`, `model`, `result`, `loading`,
  `error`, `rateLimitStatus`) and orchestration. Single page, no router.
- `src/components/InputForm.jsx` — profile-type picker, URL input or resume textarea/file upload,
  severity picker, model picker (values must match `MODEL_OPTIONS` keys in `api/roast.js`).
- `src/components/RoastCard.jsx` — renders the roast, an interactive tip checklist, share
  (`navigator.share` with clipboard-copy fallback), and save-as-image (`html2canvas`).
- `src/lib/openai.js` — thin fetch wrappers (`getRoast`, `getRateLimitStatus`) against `/api/roast`
  and `/api/rate-limit-status`. Despite the filename, no OpenAI SDK code runs client-side. `getRoast`
  branches on the response's `Content-Type`: a plain JSON response (scrape-failure fallback, 429,
  missing-key error) is handled the old way; an SSE response is read by hand via
  `res.body.getReader()` (the browser's `EventSource` only supports `GET`, so it can't be used for a
  `POST`-triggered stream) — each `roast` frame invokes the caller-supplied `onRoastChunk(text)`, and
  the `complete` frame's data becomes the resolved return value. `App.jsx`'s `handleSubmit` passes an
  `onRoastChunk` that live-updates `result.roast` (with `tips` kept at `[]` until the real end),
  so `RoastCard` visibly fills in while `loading` is still `true`.
- Styling is Tailwind v4 (`@tailwindcss/vite`), but most components use inline `style={{}}` objects
  with hardcoded hex colors (dark theme, `'Courier New', monospace`) rather than Tailwind utility
  classes or theme tokens — follow that existing pattern rather than introducing a Tailwind palette.

### Deployment
`vercel.json` sets `maxDuration: 60` for `api/roast.js` only — LinkedIn/Instagram scraping plus the
OpenAI call has to fit inside that window, which is why the Apify poll budget is kept short.

### Model eval harness
`scripts/eval-models.mjs` (not part of the deployed app — run manually, never in CI) compares the
`gpt-4o` baseline against OpenRouter candidates for the Section 4 GPT-4o → open-model migration. Its
candidate list (Llama 3.3, DeepSeek V3.2, Qwen3) is independent of `MODEL_OPTIONS` in `api/roast.js`
— the eval script is for exploring candidates, `MODEL_OPTIONS` is what's actually live in the UI
switch (currently GPT-4o + Cohere Command A/R, chosen after evaluation). It reuses the real
`getSystemPrompt()` from `api/roast.js` against 8 synthetic profile fixtures in
`scripts/eval-fixtures.mjs` (fictional people, not scraped), and writes one Markdown file per
fixture to `scripts/eval-output/` (gitignored — regenerate, don't commit) with every model's output
side by side, plus a per-model JSON-parse-failure count. Needs both `OPENAI_API_KEY` and
`OPENROUTER_API_KEY` in `.env`; run with `node scripts/eval-models.mjs`.

## Task tracking
`ROASTIFY_TASKS.md` holds a prioritized improvement backlog (critical fixes → UX → production
readiness → LLM migration to OpenRouter → feature ideas) — check it before starting open-ended work.
`WORK_LOG.md` is a dated, newest-first log of what's actually been done (and why) — add an entry
there after any non-trivial change, alongside updating this file if the change affects architecture.
