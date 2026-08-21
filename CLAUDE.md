# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code standards

- Simple over clever. The obvious implementation beats the elegant one.
- No speculative abstraction. Don't build for requirements that don't exist yet. Two similar things
  are not a pattern; three might be.
- No defensive noise: no try/catch that just rethrows, no null checks for values that can't be null,
  no wrapper functions with a single caller.
- Comments explain *why*, never *what*. If the code needs a comment to say what it does, rewrite the
  code.
- Delete code rather than commenting it out or leaving it unreferenced.
- Match existing patterns in the file. Don't introduce a second way of doing something that already
  has a way.
- Prefer fewer, larger files over many tiny ones — but split a file the moment it holds genuinely
  unrelated concerns.
- Tests assert behaviour, not implementation detail.
- When a task is done, re-read the full diff and remove anything that isn't load-bearing.

## Commands

```
npm install       # install deps
npm run dev       # Vite dev server (frontend only)
npm run build     # production build (vite build)
npm run lint      # eslint . — see "Linting" note below, does NOT cover api/
npm test          # vitest run — api/**/*.test.js (colocated with the modules they test)
npm run preview   # preview a production build
```

Run a single test file/case with `npx vitest run api/_lib/scrapers/github.test.js -t "extractGithubUsername"`
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
from values like real `dotenv` does) — required vars: `GROQ_API_KEY`, `APIFY_API_TOKEN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; add `OPENAI_API_KEY` (or `VITE_OPENAI_API_KEY`)
too if you want the dev-only GPT-4o comparison option to work locally (requires `NODE_ENV=development`
— see "Model selection" below).

### Linting
`eslint.config.js` globally ignores `api/**` (and a nonexistent `roastify-backend/**`), so
`npm run lint` never lints anything under `api/` — including its `*.test.js` files. Verify backend
changes with `node --check <file>` instead, or run `npx eslint <path> --no-ignore` if you
specifically want lint feedback there.

## Architecture

### Request flow (`api/roast.js`)
`api/roast.js` itself is just the `handler` plus model-selection logic (see point 5) — scraping,
streaming, and prompt/fencing concerns live in `api/_lib/`; see "Module layout" below for the full
map. It was ~935 lines holding four unrelated concerns before that split; it's ~310 now.

1. Frontend (`src/App.jsx`) collects `url`/`type`/`severity`/`model` via `InputForm`, calls
   `getRoast()` in `src/lib/openai.js`, which POSTs to `/api/roast`.
2. CORS preflight (`OPTIONS`) is handled first via `api/_lib/cors.js` — see "CORS" below for the
   allowlist.
3. There are two input mechanisms now, split by `type`, not four uniform ones:
   - **Scraped** (`github`, `instagram`) — the handler fetches the profile itself, wrapped in
     `withScrapeCache` (`api/_lib/scrapeCache.js`, per-type Redis TTL keyed by `type:identifier` —
     see "Rate limiting & caching" below) so re-roasting the same profile at a different severity
     doesn't redo the scrape:
     - `github` → GitHub REST API directly, no auth token (subject to unauthenticated rate limits).
       `api/_lib/scrapers/github.js`.
     - `instagram` → an Apify actor, via `runApifyScrape()` in `api/_lib/scrapers/apify.js`. Tries a
       list of actor-name candidates in sequence (actor slugs get renamed/deprecated on Apify, so
       this is resilience against that), then polls the run status, silently retrying a failed status
       check until the poll budget runs out (rather than failing the whole scrape on one flaky
       check). `api/_lib/scrapers/instagram.js`.
   - **Uploaded** (`linkedin`, `resume`) — no scraping at all; the request body already carries the
     text, and the handler just passes it straight through as `profileData` (not cached — there's
     nothing to re-fetch). `InputForm.jsx` shows the same PDF-upload + paste-textarea UI for both
     (`extractPdfText()` via `pdfjs-dist`, client-side, not on the server) — `linkedin` is the user's
     own "Save to PDF" export of their profile, `resume` is their resume. `linkedin` used to be
     scraped via an Apify actor like Instagram, but that actor never worked: LinkedIn blocks
     unauthenticated profile reads (the run log showed "Unexpected profile response" on every
     attempt), and the only working alternative needs a session cookie — a ToS violation that breaks
     constantly. PDF upload/paste is 100% reliable and has no legal grey area, so scraping was removed
     entirely rather than patched. `linkedin` still gets its own `TYPE_FRAGMENTS` prompt fragment
     (buzzwords, professional facade — see "Prompt layer & personas" below) even though the input
     path is now identical to `resume` — the content being roasted still differs.
   All outbound `fetch` calls to GitHub/Apify go through `fetchWithRetry` (`api/_lib/fetchWithRetry.js`,
   exponential backoff on network errors and 429/5xx). The Apify actor-start POST is capped at 1 retry
   since it's non-idempotent (starts a billed run) — everything else uses more generous defaults.
4. The resulting text is truncated to `MAX_INPUT_LENGTH` (4000 chars), *then* wrapped in an
   injection-defense fence via `fenceUntrustedContent()` (`api/_lib/prompts/fence.js`) before being
   sent to the model — truncating first is deliberate, so the closing fence can never get cut off. See
   "Prompt injection defense" below.
5. **Model selection**: `MODEL_OPTIONS` in `api/roast.js` registers `gpt-oss-120b` (Groq, the
   `DEFAULT_MODEL_KEY` — `openai/gpt-oss-120b` routed through Groq's OpenAI-compatible endpoint,
   `baseURL: "https://api.groq.com/openai/v1"`, free tier) and `gpt-4o` (OpenAI, dev-only comparison —
   see ROASTIFY_TASKS.md section 4B). `resolveModelOption(modelKey)` is a pure function (falls back to
   `DEFAULT_MODEL_KEY` for an unknown/missing key — same pattern as the `severity` validation);
   `getClient(modelOption)` lazily builds the right client (OpenAI vs Groq creds) per request.
   **`resolveProductionSafeModelOption(modelKey, nodeEnv)` is the actual security boundary**: outside
   `NODE_ENV === "development"` it ignores whatever `model` the client sent entirely and always
   resolves to `DEFAULT_MODEL_KEY` — the handler calls this (not `resolveModelOption` directly) with
   `process.env.NODE_ENV`, so a modified client can't select GPT-4o (or anything else) in production
   no matter what it sends. `InputForm.jsx`'s model picker only renders when `import.meta.env.DEV` is
   true, and `App.jsx` doesn't send a `model` field at all when it's hidden — but that's UX, not the
   boundary; the server-side check is what actually enforces this.
   **`buildCompletionParams(modelOption, systemPrompt, userMessageContent)`** builds the actual
   `chat.completions.create()` call params, and deliberately differs per provider: Groq's gpt-oss
   models buffer their entire response server-side under `response_format: json_object` (confirmed by
   logging raw stream chunks directly against Groq — content arrived as one atomic chunk instead of
   token-by-token), so for `"groq"` the JSON contract is enforced by the system prompt's own "Return
   ONLY JSON" instruction instead (dropping `response_format` restores real streaming), plus
   `reasoning_effort: "low"` to cut the invisible reasoning phase (~1.8s → ~500ms) and reduce
   reasoning-token spend against the free-tier rate limit. `gpt-4o` keeps `response_format:
   json_object` (it streams fine with it, and it's a strictly safer JSON guarantee). Because
   prompt-only JSON enforcement isn't a hard guarantee the way `response_format` is, a JSON-parse
   failure (code `LLM_PARSE_FAILURE`) or missing `roast`/`tips` field (code `LLM_INVALID_FORMAT`) logs
   a structured line via `logFailure()` including the raw model buffer, truncated to 2000 chars — grep
   production logs for those codes if reliability needs re-checking; re-run `node scripts/eval-models.mjs`
   if they start showing up. See "Error handling" below for the full failure-path design. The selected model is called with a
   system prompt from `getSystemPrompt(type, severity, personaId)` — composed from named fragments
   (persona voice, profile type, severity intensity) rather than one fixed persona; see "Prompt layer
   & personas" below. The model is forced to return `{ roast, tips }` JSON. Clients are built lazily
   (not at module load) specifically
   so a missing API key doesn't crash the process on import — it surfaces as a normal 500 from the
   handler's own key check instead, and the module stays importable by Vitest without needing any env
   vars set.
6. **Streaming**: scraping succeeding is not enough to commit to SSE — the handler first calls
   `chat.completions.create({ stream: true, ... })` and awaits just the *promise*, which resolves once
   the provider accepts the request (or rejects with a real error — see "Error handling" below). Only
   once that succeeds does the response switch to SSE (`Content-Type: text/event-stream`, headers
   flushed) and the handler start relaying roast text live as `event: roast` frames (`{ text }`,
   cumulative so far) while it arrives token-by-token, using `extractStreamingRoastText()`
   (`api/_lib/streaming.js`, alongside the `sendSseEvent()` helper) to pull the `"roast"` string value
   out of the still-incomplete `{ "roast": ..., "tips": [...] }` JSON buffer (handles partial/mid-
   escape-sequence buffers by just waiting for more data — see `api/_lib/streaming.test.js`). `tips`
   isn't streamed incrementally; once the model finishes, the full buffer
   is `JSON.parse`d and everything (`roast`, `tips`, `modelUsed`, `persona`, `rateLimit`, and the
   dev-only debug fields) ships in one final `event: complete` frame.
7. Every response — success, error JSON, or `error`/`complete` SSE frame — includes
   `rateLimit: { limit, remaining, reset }`. A successful `complete` event also includes `modelUsed`
   (the selected model's display label, dev-only display — see "Model selection" above) and `persona`
   (the resolved persona id, e.g. `"cynic"` — always shown, it's a real production feature). `RoastCard.jsx`
   shows persona always and `modelUsed` only in dev, both next to "roast output". See "Error handling"
   below for what happens on any failure — there is no canned fallback roast anymore; every failure path
   is a real, honest error.
8. `_debug_scraped_data` / `_debug_scraped_raw` (the raw scrape payload) are only attached to the
   `complete` event when `NODE_ENV === "development"`.

### Error handling
There is no canned fallback roast — that was deliberately deleted (`defaultGithubResponse` /
`defaultLinkedInResponse` / `defaultInstagramResponse` / `defaultResumeResponse` and
`FALLBACK_RESPONSES` are gone). Every failure returns an honest, specific error instead, using one
envelope shape shared by JSON responses and SSE `error` frames alike:
```
{ error: { code: "SCRAPE_NOT_FOUND", message: "...", retryable: false } }
```
- `api/_lib/errors.js` (zero dependencies — safe for the frontend bundle to import directly) defines
  `ERROR_CODES`, the `RoastError` class (`code`/`status`/`retryable`/`cause`), and `toErrorEnvelope()`.
  Scrapers throw `RoastError` at each failure site with the code/status/retryable attached directly to
  the error object — deliberately *not* pattern-matched from message text later, which would silently
  break if a message ever got reworded. A non-`RoastError` (an actual bug, not an anticipated failure)
  gets a generic `INTERNAL_ERROR` envelope; its real message never reaches the client, only the log
  (via `cause`).
- **Status code mapping** (scrapers — `github`/`instagram` only now; `linkedin`/`resume` don't scrape,
  so they only ever hit `MISSING_INPUT`, see below): 400 `SCRAPE_INVALID_INPUT` (bad URL/username), 404
  `SCRAPE_NOT_FOUND` (user/profile doesn't exist or isn't public), 502 `SCRAPE_UPSTREAM_FAILURE`
  (GitHub/Apify itself failed), 504 `SCRAPE_TIMEOUT` (Instagram's Apify poll ran out of attempts).
- **`MISSING_INPUT`** (400): the request body's `url` field (which, for `linkedin`/`resume`, actually
  holds pasted-or-PDF-extracted text) is empty *or whitespace-only* — the trim check is the
  server-side backstop for a failed/empty client-side PDF extraction, in case `InputForm.jsx`'s own
  guard (see "Frontend structure" below) is ever bypassed.
- **Three distinct failure phases**, each handled differently:
  1. *Scrape failures* (before any response format is committed) → real HTTP status + envelope, no
     SSE ever entered.
  2. *LLM call setup failures* — `chat.completions.create()` itself rejects (bad key, network error,
     provider outage) — happen **before** SSE headers are sent, so these also get a real HTTP status
     (`LLM_UPSTREAM_FAILURE`, 502) rather than downgrading silently. This is why the `create()` call is
     awaited *before* `res.setHeader`/`res.flushHeaders()` — see the "Streaming" point above.
  3. *LLM failures after streaming has started* (mid-loop network drop, `LLM_EMPTY_RESPONSE`,
     `LLM_PARSE_FAILURE`, `LLM_INVALID_FORMAT`) — headers are already committed at this point, so these
     send an `event: error` SSE frame with the envelope instead of a fake `complete` event. The client
     (`src/lib/openai.js`'s `consumeRoastStream`) throws on an `error` frame the same way it would on a
     rejected fetch, so `App.jsx` handles both through one `catch` block.
- **Logging**: `logFailure(err, { type, model, persona, buffer })` (a private helper in `api/roast.js`
  — it's tightly coupled to the handler's own catch sites, not a reusable concern like the scrapers or
  streaming were) writes one `JSON.stringify`'d line per failure with `code`/`type`/`model`/`persona`/
  `message` (plus `causeMessage` when `cause` is set). Deliberately
  never logs the scraped profile content or resume text — no PII. `LLM_PARSE_FAILURE` /
  `LLM_INVALID_FORMAT` additionally get `bufferPreview` (the raw model output, truncated to 2000
  chars) — this is the real-world signal for how often prompt-only JSON enforcement (see "Model
  selection" above) actually fails; grep logs for those two codes if reliability needs re-checking.
- **Client**: `retryable` drives the UI in `App.jsx` — a `true` value shows a "try again" button next
  to the error message (just re-invokes `handleSubmit`); `false` doesn't. Rate-limit errors (429) are
  deliberately `retryable: false` even though the request would eventually succeed — retrying
  immediately would just 429 again, and the countdown in `rateLimitStatus` already tells the user when
  to come back, so a generic "try again now" affordance would be misleading there.

### Prompt layer & personas
`getSystemPrompt(type, severity, personaId)` (in `api/_lib/prompts/index.js`, re-exported from
`api/roast.js` so it stays the entry point `scripts/eval-models.mjs` imports) composes the system
prompt from named fragments instead of maintaining one template literal per profile type — the
pre-persona version had 4 near-identical templates differing by only a couple of lines each; adding
3 personas to that structure would have meant 12. `api/_lib/prompts/` holds:
- `fragments.js` — the static text fragments, grouped in one file since they're the same concern
  (fixed prompt content — as opposed to `personas.js`'s registry/resolver/logic, or `fence.js`'s
  content-transformation logic). Was 4 separate few-line files (`base.js`/`types.js`/`severity.js`/
  `untrustedDataNotice.js`) until a cleanup pass merged them; nothing about their content changed.
  Exports:
  - `BASE_FRAGMENT`: app framing and the output contract (`{ roast, tips }` JSON, 5-7 tips). Shared
    across every combination.
  - `TYPE_FRAGMENTS`: what to actually look at per profile type (contribution graph vs. buzzwords vs.
    aesthetic vs. formatting) — voice- and intensity-independent.
  - `SEVERITY_FRAGMENTS`: the `mild` / `medium` / `destroy me` intensity dial, unchanged from the
    pre-persona version.
  - `UNTRUSTED_DATA_NOTICE` — see "Prompt injection defense" below — reused here, not duplicated.
- `personas.js` — the persona registry (see below).
- `fence.js` — `fenceUntrustedContent()`, see "Prompt injection defense" below. Lives alongside the
  other prompt-layer modules (moved out of `api/roast.js` in the same cleanup pass that split the
  scrapers out) since it's the other half of the same injection-defense story as
  `UNTRUSTED_DATA_NOTICE`, even though it's transformation logic rather than static fragment data —
  that's why it's its own file rather than folded into `fragments.js`.
- `index.js` — the composer (`getSystemPrompt()` itself).
`getSystemPrompt()` resolves the persona (falling back to the default for an unknown/missing id) and
joins `[BASE_FRAGMENT, persona.promptFragment, typeFragment, severityFragment, UNTRUSTED_DATA_NOTICE]`
with blank lines. Order isn't correctness-sensitive, just readable.

**Persona registry** (`api/_lib/prompts/personas.js`) follows the exact `MODEL_OPTIONS` +
`resolveModelOption` pattern: a plain-data registry (`PERSONAS`), a `DEFAULT_PERSONA_ID` ("cynic"),
and a pure `resolvePersona(personaId)` that falls back to the default for unknown/missing input —
same validation discipline as `severity` and `model`. Each entry is
`{ id, name, tagline, promptFragment, allowedTypes }`. Three personas ship:
- **`cynic`** (default) — the original voice, extracted as-is from the pre-persona hardcoded prompt
  (Gervais-flavored, "I don't care," "Truly pathetic," mortality references, 5-10% Hinglish). Not
  rewritten during the refactor — this tone is the product's identity.
- **`recruiter`** — savage but professionally framed, a pass/fail hiring evaluation rather than a
  comedy roast: no jokes, no nihilism, no Hinglish, opens with a direct verdict ("I'd pass on this in
  eight seconds..."), cites specifics from the profile as evidence. Its tips are meant to be the most
  concrete of the three — exact rewrites, not general advice.
- **`desi-uncle`** — comparison-based roasting ("Sharma ji ka beta" energy), disappointed rather than
  cruel, heaviest Hinglish of the three. Carries a mandatory guardrail line in its own fragment: must
  land as funny, never as genuinely demeaning about family, caste, class, or background.

`allowedTypes` is `["github", "linkedin", "instagram", "resume"]` for all three currently — every
persona works with every profile type today. The enforcement (`isPersonaAllowedForType(persona,
type)`, also in `personas.js`) is real and wired into the handler anyway (checked right after the
model/key check, before rate limiting or scraping — see `api/roast.js`), returning
`PERSONA_NOT_ALLOWED_FOR_TYPE` (400) if violated. This can't currently trigger with the shipped
registry, but it means a future persona restricted to a subset of types (e.g. a debate-mode voice not
valid for a straight profile roast) needs no second enforcement pass added later.

The client mirrors the registry manually rather than cross-importing across the frontend/backend
boundary — `src/lib/personas.js` exports a small `PERSONAS` array (`{ value, name, tagline }`) used
by `InputForm.jsx`'s persona picker (always visible, unlike the dev-only model picker) and by
`App.jsx` to resolve the id `RoastCard.jsx` receives in the `complete` event into a display name. This
follows the same pattern `InputForm.jsx`'s `models` array already used for `MODEL_OPTIONS`.

`scripts/eval-models.mjs`'s model-comparison loop uses the default persona (cynic) for every model,
matching current production behavior. It also runs a separate persona-comparison per fixture — the
same input across all 3 personas, against the production default model only (not the full model
matrix) — written into the same per-fixture Markdown file as a second section. See "Model eval
harness" below.

### Prompt injection defense
All scraped/pasted profile content (GitHub bio, LinkedIn headline, Instagram captions, resume text)
is attacker-controlled — anyone can put arbitrary text, including fake instructions, into a public
bio. `fenceUntrustedContent()` (`api/_lib/prompts/fence.js`) wraps it before it ever becomes the user
message:
- Generates a fresh random hex marker per request (`crypto.randomBytes(8)`) and wraps content as
  `<<<PROFILE_DATA_<hex>>>> ... <<<END_PROFILE_DATA_<hex>>>>`. The marker is unpredictable *at scrape
  time* — it's generated after the content was already written — so attacker-controlled text can never
  legitimately contain today's exact closing fence.
- Strips any fence-*shaped* substring already present in the content (`FENCE_MARKER_PATTERN`) as
  defense in depth, in case someone tries to fake a boundary by guessing the format (or a wrong-hex
  attempt hoping the model doesn't distinguish precisely).
- `UNTRUSTED_DATA_NOTICE` (`api/_lib/prompts/fragments.js`) — one shared instruction
  fragment, composed into every `getSystemPrompt()` call regardless of type or persona (see "Prompt
  layer & personas" above) — tells the model everything inside the fence is inert data describing the
  person being roasted, never instructions to follow regardless of what it claims to be, and that any
  instructions found inside it should themselves be roasted, not obeyed.
- Applied uniformly to all 4 profile types (including pasted/PDF-extracted resume text) via the single
  `userMessageContent` variable in the handler, **after** `MAX_INPUT_LENGTH` truncation — truncating
  first is required so the closing fence can never get cut off by the length cap.

### CORS
`api/_lib/cors.js`'s `applyCors(req, res)` reflects `Access-Control-Allow-Origin` back only when the
request's `Origin` header matches an allowlist — it doesn't just always set the production origin,
since that would break Vercel preview deploys entirely (a preview's own origin would never match a
hardcoded production-only value). Allowed: the production origin
(`https://roastify-two.vercel.app`), this project's Vercel preview deployments
(`^https://roastify-two-[a-z0-9-]+\.vercel\.app$` — Vercel names preview URLs
`<project-name>-<slug>.vercel.app`), and `http://localhost:<any port>` for local dev. Anything else
gets no `Access-Control-Allow-Origin` header at all (not an empty/wildcard one) — the browser enforces
the actual block. `handleCorsPreflight(req, res)` (the function `api/roast.js` /
`api/rate-limit-status.js` actually call) applies this and additionally ends the response for an
`OPTIONS` preflight. See `api/_lib/cors.test.js`.

### Rate limiting & caching
`api/_lib/rateLimit.js` exports `createRedisClient()` (shared by rate limiting and scrape caching),
`getClientIP`, `createRatelimit()`, and `RATE_LIMIT_MAX` (`= 5`, imported by `api/rate-limit-status.js`
for its own unavailable-Redis fallback response). `RATE_LIMIT_WINDOW` (`"1 h"`) is *not* exported —
nothing outside this file ever needed it; it was exported for no reason until a cleanup pass noticed
and fixed it. `createRatelimit()` builds an Upstash Redis sliding-window limiter from both constants.
- `api/roast.js` consumes one token per request and fails open (logs and continues without limiting)
  if Upstash is unreachable.
- `api/rate-limit-status.js` is a separate, non-consuming `GET` endpoint (`ratelimit.getRemaining()`)
  that the frontend calls on page load so it can show remaining-roasts / cooldown state before the
  user ever submits, not just react to a 429 after the fact.
- **Dev-only bypass**: both endpoints skip the Upstash check entirely when
  `process.env.NODE_ENV === "development"` — same `NODE_ENV` pattern as
  `resolveProductionSafeModelOption` and the `_debug_scraped_*` payload (see "Model selection"
  above and point 8 in "Request flow"); production behavior (including the fail-open catch) is
  untouched outside dev. In `api/roast.js` this means `rateLimitInfo` stays `null` for the request,
  same as the existing fail-open case when Upstash itself is unreachable — no new response shape.
  `api/rate-limit-status.js` returns `{ limit: null, remaining: null, reset: null, unlimited: true }`
  instead of a real (or fake) count, so the frontend isn't left displaying a stale/misleading number
  — `App.jsx` checks `rateLimitStatus.unlimited` first and renders "rate limit bypassed (dev)" rather
  than falling into its cooldown-message branches. See the "rate limit dev bypass" describe blocks in
  `api/roast.test.js` / `api/rate-limit-status.test.js`.
- `api/_lib/scrapeCache.js`'s `withScrapeCache` also fails open on any Redis error (read or write) —
  caching is a cost optimization, never a correctness requirement, so a broken cache must not block
  a roast. TTL is per-type, not a single constant: 1 hour for `github` (a free API, cheap to re-hit)
  and 24 hours for `instagram` (Apify runs are billed, and profiles change slowly). `linkedin`/`resume`
  have no entry — they're not scraped at all, so there's nothing to cache. See
  `api/_lib/scrapeCache.test.js`.

### Frontend structure
- `src/App.jsx` — all top-level state (`url`, `type`, `severity`, `persona`, `model`, `result`,
  `loading`, `error`, `rateLimitStatus`) and orchestration. Single page, no router.
- `src/components/InputForm.jsx` — profile-type picker; a URL input for `github`/`instagram`, or a
  shared upload UI (file input + paste textarea, `isUploadType = type === "resume" || type ===
  "linkedin"`) for `linkedin`/`resume` — both extract text the same way (`extractPdfText()` via
  `pdfjs-dist` for a PDF, `file.text()` for `.txt`, or manual paste), sharing one `pastedText` state
  and one `handleFileChange()`. `linkedin` additionally shows a one-line hint above the upload
  ("Open your LinkedIn profile → More → Save to PDF, then upload it here.") since users won't know
  that export path exists. Extraction failures (unreadable file, wrong file type, or a PDF with no
  extractable text) set an `uploadError` string shown in place of the status line — previously a
  failed extraction failed silently in a bare `catch {}`, leaving the user staring at nothing having
  happened. Also has a severity picker, a persona picker (always visible — real production feature, values from
  `src/lib/personas.js`'s `PERSONAS`, shows name + tagline per option), and a model picker (values
  must match `MODEL_OPTIONS` keys in `api/roast.js`) that only renders when `import.meta.env.DEV` —
  production users never see the model picker (see "Model selection" above), but do see the persona
  picker.
- `src/components/RoastCard.jsx` — renders the roast, an interactive tip checklist, share
  (`navigator.share` with clipboard-copy fallback), and save-as-image (`html2canvas`). Shows
  `personaName` next to "roast output" always; `modelUsed` only in dev.
- `src/lib/personas.js` — frontend mirror of `api/_lib/prompts/personas.js`'s registry
  (`{ value, name, tagline }` per persona, kept in sync manually rather than cross-imported across the
  frontend/backend boundary — same pattern `InputForm.jsx`'s `models` array uses for `MODEL_OPTIONS`).
  `App.jsx` uses its `personaName()` helper to resolve the id the `complete` event carries into a
  display string for `RoastCard`.
- `src/lib/openai.js` — thin fetch wrappers (`getRoast`, `getRateLimitStatus`) against `/api/roast`
  and `/api/rate-limit-status`. Despite the filename, no OpenAI SDK code runs client-side. `getRoast`
  now takes `(url, type, severity, model, persona, { onRoastChunk })` — `persona` is always sent when
  provided (unlike `model`, which is dev-only-conditional; see "Model selection" above). It branches
  on the response's `Content-Type`: a plain JSON response (scrape failure, missing-input, 429,
  missing-key, LLM-setup, or persona/type-mismatch error — see "Error handling" above) has its
  `{ error: {...} }` envelope turned into a thrown `Error` via `errorFromEnvelope()` (also imported by
  `App.jsx` indirectly through the errors it catches); an SSE response is read by hand via
  `res.body.getReader()` (the browser's `EventSource` only supports `GET`, so it can't be used for a
  `POST`-triggered stream) — each `roast` frame invokes the caller-supplied `onRoastChunk(text)`, an
  `error` frame throws the same envelope-derived `Error` (ending the stream), and the `complete`
  frame's data becomes the resolved return value. Every thrown error carries `.message`, `.code`,
  `.retryable`, and `.rateLimit`. `App.jsx`'s `handleSubmit` passes an `onRoastChunk` that
  live-updates `result.roast` (with `tips` kept at `[]` until the real end), so `RoastCard` visibly
  fills in while `loading` is still `true`; on any thrown error it clears `result`, shows
  `err.message` directly, and renders a "try again" button only when `err.retryable` is true
  (re-invokes `handleSubmit`).
- Styling is Tailwind v4 (`@tailwindcss/vite`), but most components use inline `style={{}}` objects
  for color/font rather than Tailwind utility classes — follow that existing pattern rather than
  introducing Tailwind color classes. Colors themselves are CSS custom properties defined once in
  `src/index.css`'s `:root` (`--color-bg-primary`, `--color-bg-surface`, `--color-bg-hover`,
  `--color-bg-tertiary`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`,
  `--color-accent`, `--color-accent-hover`, `--color-border`, plus `--font-family`) — reference them as
  `"var(--color-accent)"` etc, including inside imperative `element.style.x = "var(--color-accent)"`
  hover-state assignments and inside Tailwind arbitrary-value brackets (`text-[var(--color-text-primary)]`
  — Tailwind v4 compiles `var()` inside `[...]` straight through to real CSS). Do **not** hardcode a new
  hex value inline; add or reuse a token instead. The one deliberate exception is
  `RoastCard.jsx`'s `handleSaveAsImage()`, which passes a literal hex to `html2canvas`'s
  `backgroundColor` option — that value becomes a canvas `fillStyle`, which does not resolve CSS custom
  properties, so it can't reference a token and must be kept in sync with `--color-bg-surface` by hand.

### Deployment
`vercel.json` sets `maxDuration: 60` for `api/roast.js` only — Instagram scraping (the only remaining
Apify-scraped type; `linkedin` no longer scrapes) plus the OpenAI call has to fit inside that window,
which is why the Apify poll budget is kept short.

### Model eval harness
`scripts/eval-models.mjs` (not part of the deployed app — run manually, never in CI) compares the
`gpt-4o` dev-only baseline against Groq candidates (`openai/gpt-oss-120b` — the production default,
`openai/gpt-oss-20b`, `qwen/qwen3.6-27b`) — all using the default persona (cynic), matching current
production behavior. Its candidate list is independent of `MODEL_OPTIONS` in `api/roast.js` — the
eval script is for exploring candidates, `MODEL_OPTIONS` is what's actually reachable (production is
pinned to `gpt-oss-120b` regardless; `gpt-4o` only exists behind the dev-only picker). It reuses the
real `getSystemPrompt()` from `api/roast.js` against 8 synthetic profile fixtures in
`scripts/eval-fixtures.mjs` (fictional people, not scraped), and writes one Markdown file per fixture
to `scripts/eval-output/` (gitignored — regenerate, don't commit) with a "Model comparison" section
(every model's output side by side, plus a per-model JSON-parse-failure count) followed by a "Persona
comparison" section — the same fixture run across all 3 personas (`PERSONAS`, imported from
`api/roast.js`) against the production default model only, so it's reading voices against each other
rather than a full model x persona cross-product. The persona section calls out three things to check
per fixture: whether `recruiter` stays useful at `mild`, whether `desi-uncle` stays funny at
`destroy me`, and whether `cynic` changed at all versus the model-comparison section above (it
shouldn't — same fragment content, same default persona). Needs both `OPENAI_API_KEY` and
`GROQ_API_KEY` in `.env`; run with `node scripts/eval-models.mjs`.

## Task tracking
`ROASTIFY_TASKS.md` holds a prioritized improvement backlog (critical fixes → UX → production
readiness → LLM provider work → feature ideas) — check it before starting open-ended work.
`WORK_LOG.md` is a dated, newest-first log of what's actually been done (and why) — add an entry
there after any non-trivial change, alongside updating this file if the change affects architecture.
