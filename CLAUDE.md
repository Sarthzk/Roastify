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

## Git workflow

- All work happens on the `dev` branch. Don't create a new branch per task, and never
  commit directly to `main`.
- If `dev` doesn't exist, create it from `main`. If it does, make sure it's checked up to
  date before starting.
- Before starting any work, confirm the working tree is clean. If it isn't, stop and tell
  the user rather than committing changes that aren't yours.
- Commit when the task is complete and verified — lint, tests, and build all passing. Not
  before.
- Write a real commit message: a short subject line describing what changed, then a body
  explaining why. Match the level of detail in `WORK_LOG.md`.
- Push `dev` to origin after committing, every time. This is the backup — no task ends
  with work sitting only on the local machine.
- Do not merge to `main`, do not open a PR, do not force-push. The user reviews and
  merges to `main` themselves.

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
— see "Model selection" below). `INSTAGRAM_ENABLED` is optional (defaults to enabled) — see the
Instagram kill switch note under "Request flow" below. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` are all optional together — see "Auth & persistence" below; the app runs
fully anonymous-only with all three unset.

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
       check). `api/_lib/scrapers/instagram.js`. **Kill switch**: Instagram is the app's only
       remaining scraping dependency, so it needs to be disposable without a deploy if the Apify
       actor breaks — `isInstagramEnabled()` (`api/_lib/config.js`, `process.env.INSTAGRAM_ENABLED
       !== "false"`, same boolean-string convention as `NODE_ENV === "development"`) is checked right
       after the persona/type check, before rate limiting, and rejects a disabled Instagram request
       with `SOURCE_UNAVAILABLE` (503) — see "Error handling" below. `api/rate-limit-status.js` also
       reports `instagramEnabled` in every response shape (reusing the endpoint the frontend already
       polls on page load rather than adding a new one). **Separately**, Instagram also requires
       sign-in — checked right after the kill switch, same early-exit spot, rejecting an anonymous
       instagram request with `SIGN_IN_REQUIRED` (401) — see "Auth & persistence" below for why
       (Apify is the app's only paid dependency) and "Error handling" for the error code. The two
       checks are independent: the kill switch is an operational "Apify itself is broken" state,
       sign-in is a permanent product policy, and either one alone is enough to reject the request —
       but the kill switch outranks the lock in `InputForm.jsx`'s own state (see "Routing and page structure"
       below): a signed-in user sees Instagram as `off`, not selectable, if the scraper itself is
       down. Neither state hides the card — see "Routing and page structure" for why.
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
   (the resolved persona id, e.g. `"cynic"` — always shown, it's a real production feature). `App.jsx`
   resolves it to a display name (`personaName()`) for the Output section's meta row; `RoastCard.jsx`
   shows `modelUsed` only in dev, appended to the "Roast" gutter label. See "Error handling" below for
   what happens on any failure — there is no canned fallback roast anymore; every failure path is a
   real, honest error.
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
  503 `SOURCE_UNAVAILABLE` is a separate case, not a scrape failure — it fires before any scrape is
  attempted, when `type === "instagram"` and the `INSTAGRAM_ENABLED` kill switch (see "Request flow"
  above) is off. 401 `SIGN_IN_REQUIRED` is likewise not a scrape failure — it fires when
  `type === "instagram"` and the request has no valid Supabase JWT (see "Auth & persistence" below).
- **`MISSING_INPUT`** (400): the request body's `url` field (which, for `linkedin`/`resume`, actually
  holds pasted-or-PDF-extracted text) is empty *or whitespace-only* — the trim check is the
  server-side backstop for a failed/empty client-side PDF extraction, in case `InputForm.jsx`'s own
  guard (see "Routing and page structure" below) is ever bypassed.
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
- **Client**: `retryable` flows through `App.jsx`'s `describeError()` into the Output error state's
  `error.retryable` — a `true` value renders a "try again" button (`RoastCard.jsx`, calls `onRetry`,
  which `App.jsx` wires straight to `handleSubmit`); `false` omits the button entirely, per the
  design's own instruction ("where nothing can be retried, omit the button; the detail line carries
  the resolution"). Rate-limit errors (429) are deliberately `retryable: false` even though the
  request would eventually succeed — retrying immediately would just 429 again, and the error's own
  detail line already carries a real countdown (see "Routing and page structure" below), so a generic "try
  again now" affordance would be misleading there.

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

### Auth & persistence
Sign-in (GitHub + Google OAuth via Supabase Auth) is optional infrastructure layered on
top of an app that already worked fully anonymously — it must never become a login wall.
Every piece here degrades to "everyone is anonymous" when Supabase env vars are absent
(a fork, or local dev without a project), never a crash.

- **Client** (`src/lib/supabaseClient.js`): builds a `supabase` client from
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — both are safe to expose to the browser
  (RLS, not secrecy of the anon key, is what protects data; see the migration below).
  `isSupabaseConfigured` is `false` (and `supabase` is `null`) when either is missing;
  `App.jsx` and `InputForm.jsx` both check it before rendering any sign-in UI, so a
  fork with no Supabase project just never shows one.
- **Session state** lives in `App.jsx` alongside everything else (`useState` + a
  `supabase.auth.onAuthStateChange` subscription in a `useEffect`) — no state library,
  same as the rest of the app. `signIn(provider)` calls `supabase.auth.signInWithOAuth`
  (redirects to GitHub/Google and back); `signOut()` calls `supabase.auth.signOut()`.
  The header (previously a static "no login / free" tag pair) now renders sign-in/sign-
  out controls in the same monospace-caps/hard-rule/zero-radius language as everything
  else (`.hmeta-action` in `src/index.css`, a button-reset sharing `.hmeta-item`'s
  layout) — or the original "no login" tag when Supabase isn't configured at all.
- **Server-side verification** (`api/_lib/auth.js`): `getAuthenticatedUser(req)` reads
  the `Authorization: Bearer <jwt>` header and calls `supabaseAdmin.auth.getUser(token)`
  — validated against Supabase Auth itself, never decoded/trusted locally. Returns
  `{ id, email }` or `null` (never a client-sent id) for a missing header, invalid/
  expired token, or unconfigured Supabase. `getRoast()`/`getRateLimitStatus()`
  (`src/lib/openai.js`) attach this header whenever `App.jsx` has a session; the server
  never receives or trusts a user id from the request body.
- **Admin client** (`api/_lib/supabaseAdmin.js`): a lazily-built, memoized client using
  `SUPABASE_SERVICE_ROLE_KEY` (server-only — no `VITE_` prefix, so Vite never inlines it
  into the client bundle; this is verified after every build, see "Verification" in
  `ROASTIFY_TASKS.md`'s auth section). `isSupabaseConfigured()` gates every caller.
- **Persistence** (`api/_lib/persistRoast.js`): after a roast completes (parsed
  `{ roast, tips }`, before the `complete` SSE event is sent), `persistRoast()` inserts
  one row into `roasts` via the service role key — deliberately bypassing RLS, since the
  server is the only writer this table ever gets (see the migration's own comment on why
  there's no INSERT policy for anon/authenticated). `user_id` is always the id
  `getAuthenticatedUser()` derived, or `null` for an anonymous request — every roast is
  stored either way (anonymous rows are analytics-only: not attributed, not listed in
  anyone's history), never the raw scraped/pasted profile text (no PII, same principle
  as `logFailure()`'s no-PII logging rule above). Fails open on any write error, same
  fail-open posture as `withScrapeCache` — persistence is a product feature, not a
  correctness requirement for the roast the caller already received.
- **Schema** (`supabase/migrations/`): real SQL migration files, not an ORM or runtime
  table creation. `roasts` (`user_id` nullable, `type`, `identifier`, `persona`,
  `severity`, `model`, `roast`, `tips` jsonb, plus `visibility`/`slug` — nullable and
  unused today, added now so a future public-share-page feature is additive rather than
  a schema rewrite) and `reports` (for moderating shared content later — schema only,
  no application code touches it yet). RLS is enabled on both from row one: a user can
  `select`/`delete` only rows where `auth.uid() = user_id` (which is never true for an
  anonymous row via the anon key, by construction — no special-cased policy needed);
  there is deliberately no INSERT policy for anon/authenticated on either table, since
  every write goes through the service role key server-side. No `profiles` or scrape-
  cache table — the existing Redis scrape cache (`api/_lib/scrapeCache.js`) already
  covers that, and two caches would just be redundant.
- **Instagram sign-in gate**: see the "Request flow" and "Error handling" sections above
  — `SIGN_IN_REQUIRED` (401), independent of the `INSTAGRAM_ENABLED` kill switch.
  `api/rate-limit-status.js` reports `signedIn` (alongside the existing
  `instagramEnabled`) specifically so the UI can tell these two "Instagram unavailable"
  reasons apart. As of the v3 redesign (see "Routing and page structure" below), the Instagram
  source card is never hidden for either reason — a locked or disabled source cell still
  reads as "here's what you're missing," which hiding it can't — it only changes tag and
  clicking it opens an inline prompt (sign-in buttons for "locked", an explanatory note
  with no buttons for "disabled") instead of selecting it.
- **History endpoint** (`api/history.js`, `GET`, added for the `/history` route — see
  "Routing and page structure" below): rejects a missing/invalid JWT with
  `SIGN_IN_REQUIRED` (401, reusing the same error code as the Instagram gate — same
  underlying "sign in for this" semantics). Otherwise queries `roasts` through
  `api/_lib/supabaseUser.js`'s `getSupabaseClientForUser(token)` — a per-request client
  built from the anon key plus the caller's own JWT as the `Authorization` header, not
  the service-role admin client — so the query runs *as that user* and it's Postgres RLS
  itself (the migration's "read own roasts" policy), not application code, that actually
  restricts the result to their rows. Paginated 25 at a time via an optional `?cursor=`
  query param (an ISO `created_at` timestamp — `.lt("created_at", cursor)`), returning
  `{ roasts, nextCursor }` (`nextCursor` is `null` once a page comes back short). See
  `api/history.test.js` — the JWT-rejection paths are real code-path tests; "only the
  caller's rows" is asserted as "queries via a client scoped to exactly this caller's
  token, never any other," since RLS itself (the actual guarantee) isn't something a
  unit test can exercise without a live Supabase project.

### Rate limiting & caching
`api/_lib/rateLimit.js` exports `createRedisClient()` (shared by rate limiting and scrape caching),
`getClientIP`, `createRatelimit(tier)`, `getRateLimitKey(user, ip)`, and `RATE_LIMIT_TIERS`
(`{ anonymous: { max: 3, window: "1 d" }, authenticated: { max: 15, window: "1 d" } }`). Two tiers,
not one flat limit, now that a request can be attributed to a signed-in user (see "Auth & persistence"
above) instead of only an IP — daily windows, not the original hourly one. `createRatelimit(tier)`
builds an Upstash Redis sliding-window limiter for that tier, each with its own `prefix` (so the same
key string can never collide across tiers); `getRateLimitKey(user, ip)` returns `user:<id>` when signed
in, `ip:<ip>` otherwise, so a signed-in user's quota follows their account rather than the device/
network they're on, and anonymous/signed-in use on the same device never shares a bucket.
- `api/roast.js` resolves the tier and key from `getAuthenticatedUser(req)` before consuming one token,
  and fails open (logs and continues without limiting) if Upstash is unreachable.
- `api/rate-limit-status.js` is a separate, non-consuming `GET` endpoint (`ratelimit.getRemaining()`)
  that the frontend calls on page load (and again on every sign-in/sign-out, since the tier changes)
  so it can show remaining-roasts / cooldown state before the user ever submits, not just react to a
  429 after the fact. It also reports `signedIn`/`tier` — see "Auth & persistence" above.
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

### Routing and page structure
Redesigned 2026-08-21 (v2) and again 2026-09-13 (v3) from Claude Design handoffs — see
`WORK_LOG.md` for both sessions. v3 added real routing (`react-router-dom`), the header's nav/auth,
tier-aware source states, and a `/history` page; the v2 entry below is superseded except where noted.
**Component boundaries match the design's own file-mapping table**, not an ad-hoc split:

- `src/main.jsx` wraps `<App>` in a `<BrowserRouter>`. `src/App.jsx` is now just the route table —
  three routes (`/`, `/history`, `/r/:slug`), all nested under one `<Route element={<Layout />}>` so
  they share one header/footer shell with no other nested layouts. `vercel.json`'s rewrites list a
  catch-all (`/(.*) → /index.html`) after the existing `/api/(.*)` one, so a direct hit on `/history`
  or `/r/:slug` in production is served the SPA shell instead of 404ing — Vercel only falls through to
  a rewrite when no matching static file exists, so this doesn't shadow real asset requests.
- `src/routes/Layout.jsx` owns the state every route needs — `session` (a plain `useState` fed by a
  `supabase.auth.onAuthStateChange` subscription, see "Auth & persistence" above; no auth state
  library) and `signInOpen` (the header's sign-in dropdown) — and renders the header (brand, nav,
  auth) and footer around a React Router `<Outlet context={{ session, signIn, signOut, openSignIn }}>`.
  Every route reads this via `useOutletContext()` rather than prop-drilling. Deliberately *not* where
  roaster-specific state lives — see `Roaster.jsx` below for why. Nav is two `<NavLink>`s (`roast` /
  `history`) whose `isActive` styling comes from the current path, not app state. The sign-in dropdown
  (`signInOpen`) closes itself via the same "adjust state during render" pattern used elsewhere in
  this codebase (compare against a `prevSession` state var, not a `useEffect`, when `session` flips
  from falsy to truthy — see the file's own comment) plus a real outside-click/`Escape` listener pair
  (added/removed in a `useEffect` gated on `signInOpen`, this one legitimately needs to be an effect
  since it subscribes to `document`, an external system). When `isSupabaseConfigured` is false (see
  "Auth & persistence" above), the whole nav/auth block is replaced by the original static `no login`
  tag — there's nothing to route or sign into differently. `<Outlet>` renders inside a `<main
  className="app-main">`, giving every route the standard sticky footer: `.app-root` is
  `min-height: 100dvh` (compensated for `#root`'s `zoom`, see below) and `display: flex;
  flex-direction: column`, and `.app-main` is the `flex: 1` child — not the footer. On a route
  shorter than the viewport (an idle roaster on a tall screen, a short `/history` list, `/r/:slug`)
  `.app-main` absorbs the leftover space, so the footer sits at the true bottom of the screen with
  plain background above it; on a route taller than the viewport `.app-main` already exceeds its
  flex-basis on its own, so the page just scrolls normally with the footer right after content. A
  prior version of this removed `.app-root`'s `min-height` entirely (footer flush after content,
  empty space below it instead of above) — reverted: the actual requirement was a real sticky
  footer that reaches the bottom of a short screen, not merely "no dead gap." `#root`'s `zoom` (a
  `--root-zoom` custom property, see "Layout shell" in `src/index.css`) scales this whole subtree's
  *rendered* size, so a plain `100dvh` on `.app-root` still renders about 9% short of the real
  window — confirmed by direct measurement, not assumed, per the explicit instruction that
  motivated this fix. `.app-root`'s `min-height` is `calc(100dvh / var(--root-zoom))` instead, which
  renders out to exactly `100dvh` once the zoom is applied.
- `src/routes/Roaster.jsx` (route `/`) is what `src/App.jsx` used to be minus the header/footer: owns
  `url`, `type`, `severity`, `persona`, `model`, `result`, `loading`, `error`, `rateLimitStatus`,
  `resetKey`. Deliberately kept local to this route rather than lifted into `Layout.jsx` — per the
  v3 handoff, "roaster form state... does not persist" across navigation, and a route component's
  local state resets for free on unmount/remount, which is what actually happens when you navigate to
  `/history` and back. `status` (`"idle" | "streaming" | "error" | "complete"`) is derived, not
  stored, straight from `loading`/`error`/`result`. `describeError(err, { type })` turns a thrown
  error into the `{ code, message, detail, retryable }` shape the Output error state renders — `code`
  is what lets `RoastCard` tell `SIGN_IN_REQUIRED` (an invitation, not a failure) apart from every
  other error; `detail` is synthesized from real data only, never fabricated (a `RATE_LIMITED` error
  gets a real countdown from `err.rateLimit.reset`, a scrape-family error names the source type
  checked, never the raw submitted text). `instagramOpen = instagramEnabled && signedIn` is the single
  source of truth this route uses for "is Instagram actually usable right now" — both a mid-session
  kill-switch flip and a sign-out fall back the selected type to `github` via the same effect.
- `src/components/InputForm.jsx` — source row, input row, persona row, and (as of v3) its own
  separate severity row; no longer bundles severity into a "voice" row with persona (see the v3
  handoff's own reasoning: two decisions that used to share one gutter label now each get their own).
  Source and persona cells share one visual language (`.source-card`/`.persona-cell` in
  `src/index.css` share most rules via a combined selector) — 4-up and 3-up grids of the same cell
  shape, no index numbers (v3 dropped them as decorative). Every source is always rendered — v3's
  explicit rule is "never hide a locked source, the lock is the pitch" — with per-cell `sourceState()`
  computing `"open" | "locked" | "disabled"` from `instagramEnabled` (the kill switch, prop) and
  `signedIn` (prop); the kill switch outranks the lock, so a signed-in user sees `off` too if the
  scraper itself is down. Clicking a non-open cell doesn't select it — it sets local `prompt` state
  (`"locked" | "disabled" | null`) instead, which renders an inline row under the source grid: the
  "locked" variant gets the invitation marker (outlined square, bullet) plus direct `onSignIn(provider)`
  buttons; "disabled" gets a plain dash marker and no buttons — see "Auth & persistence" above for why
  this can never read as an `ERROR` row. The prompt closes on its own `close` button, on selecting a
  different (open) source, and when `signedIn` flips true (same render-time-adjustment pattern as the
  upload state below, comparing a `prevSignedIn` var). The upload UI (`linkedin`/`resume`) is
  unchanged from v2: click-to-browse and real HTML5 drag-and-drop both funnel through one shared
  `processFile(file)` (`extractPdfText()`/`pdfjs-dist` for a PDF, `file.text()` for `.txt`); local
  state (`fileInfo`, `uploadStatus`, `uploadError`, `dragging`) resets when `type` changes via the
  render-time-adjustment pattern (a `prevType` comparison, not a `useEffect` — React's own lint rule
  flags a synchronous `setState` inside an effect body as an avoidable extra render pass). No longer
  renders its own submit button — that's `Roaster.jsx` — but still owns `Cmd/Ctrl+Enter` via an
  `onSubmit` prop. The dev-only model picker (`MODEL_OPTIONS` keys in `api/roast.js`) is unchanged,
  appended as one more gutter row only when `import.meta.env.DEV`.
- `src/components/RoastCard.jsx` — Output states: idle / streaming / error / **invitation** (new in
  v3) / complete, exactly one at a time, driven by `status` and `error` props. Streaming shows a
  single stage label derived from real stream lifecycle (`"reading profile…"` before any text, then
  `"printing…"`) — v3 also dropped the live character count and its spacer rule that v2 had alongside
  it. The invitation state fires when `error.code === "SIGN_IN_REQUIRED"` — a session expiring
  mid-flow is the only realistic way to reach it, since `InputForm.jsx`'s locked-cell gating already
  prevents submitting Instagram while signed out — and renders the same outlined-marker language as
  `InputForm.jsx`'s locked-source prompt (in fact reuses its `.source-prompt-provider` button class)
  with direct `onSignIn(provider)` buttons instead of a retry. The completed-roast meta row collapsed
  from v2's 4-cell grid to one line (`type · personaName · severity`, plus `· saved` when signed in) —
  `RoastCard` no longer needs a `modelUsed`-only concept there; that still only shows in the Roast
  label itself, dev-only. Tip checklist, share, save-as-image, and "roast another" are unchanged from
  v2.
- `src/routes/History.jsx` (route `/history`) — signed-in only, but the route itself is reachable by
  anyone (a shared `/history` link must never redirect or 404 — see the v3 handoff). Signed out: an
  invitation-marker locked panel with its own two sign-in buttons (`signIn` from the outlet context).
  Signed in: fetches `getHistory(accessToken)` on mount and on every token change (same
  render-time-adjustment pattern for resetting `loading`/`error` before the fetch, to keep the actual
  data-fetching `useEffect` free of synchronous `setState` calls at its top — see the file's own
  comment) — three states once loaded: a real error (network/auth failure distinct from "signed out"),
  an empty state (`Saved 0`, its own honest copy — "nothing here yet," not a blank section) and the
  populated list (`Saved <n>`, paginated 25 at a time via a `cursor` query param, `load more` fetches
  the next page). Rows show `type`/`identifier`/`persona`/`severity`/`created_at` from
  `api/history.js` — `identifier` renders `—` for `linkedin`/`resume` rows, which have none (see
  "Auth & persistence" above: raw pasted/PDF text is never persisted). Rows don't link anywhere yet —
  there's no real `/r/:slug` behind them until the sharing task ships real slugs.
- `src/routes/SharedRoast.jsx` (route `/r/:slug`) — shell only, per this task's explicit scope (no
  slug generation, no visibility logic, no sharing flow). Reads `:slug` via `useParams()` but has
  nothing to fetch it against yet, so it renders an honest "not shareable yet" invitation row instead
  of the design's sample roast content, plus the same growth-loop CTA (`roast me instead →`, `3 free a
  day · no account needed`) the finished page will keep once real roasts land here.
- `src/lib/personas.js` — unchanged: frontend mirror of `api/_lib/prompts/personas.js`'s registry.
- `src/lib/openai.js` — `getRoast`/`getRateLimitStatus` unchanged (still take an optional
  `accessToken` that becomes an `Authorization: Bearer` header via the shared `authHeaders()` helper).
  New: `getHistory(accessToken, cursor)` against `GET /api/history` — `cursor`, when given, is the
  previous page's `nextCursor` (an ISO `created_at` timestamp) from `api/history.js`. Throws the same
  envelope-derived `Error` shape as `getRoast` on a non-2xx response.

**Styling.** Same convention as the v2 redesign: plain CSS classes with real `@media` queries, all in
`src/index.css` (the one global stylesheet — no CSS-in-JS, no second Tailwind config; Tailwind stays
for small incidental utilities like the visually-hidden-checkbox technique). Class names still follow
the handoff's own `data-r="x"` → `.x` naming crib. Colors are CSS custom properties in `:root` —
`--ground` through `--ground-5`, `--accent`/`--accent-dk`, `--ink` through `--ink-4`, `--rule`/
`--rule-2` — unchanged token values from v2 to v3 (confirmed against the v3 handoff's own "Tokens
(unchanged)" note). Do **not** hardcode a new hex value inline; add or reuse a token instead. The one
deliberate exception is `RoastCard.jsx`'s `handleSaveAsImage()`, which passes a literal hex
(`#0a0a0a`, matching `--ground-2`) to `html2canvas`'s `backgroundColor` option — that value becomes a
canvas `fillStyle`, which doesn't resolve CSS custom properties, so it can't reference a token and
must be kept in sync by hand. Breakpoints are still 1180 / 900 / 600 / 380px with the same character
per level (type-only / columns collapse / gutter collapses and the header stacks to three bands /
small corrections) — see the v3 handoff's own README (not part of this repo) for the exact values if
tuning further. The `html, body, #root { zoom: 97% }` rule from the v2/v3 handoffs is **not**
reproduced as written: applying the same `zoom` declaration to three nested ancestors compounds
multiplicatively (0.97³ ≈ 91.27%, confirmed by direct measurement — see `WORK_LOG.md`'s 2026-08-23
entry), so it's consolidated onto `#root` alone at that already-compounded value — same visual
result, honest CSS. That value is a `--root-zoom` custom property (not a bare literal) because the
sticky-footer fix above also needs to compensate for it. Elements the v3 redesign removed outright
(and that no longer have CSS or markup
anywhere in this repo): the hero's "what it reads" side panel, the "how it works" 3-step strip, index
numbers on source/persona cells, the streaming character counter and its spacer rule, the rate-limit
tick meter, and the `cmd + enter` hint.

### Deployment
`vercel.json` sets `maxDuration: 60` for `api/roast.js` only — Instagram scraping (the only remaining
Apify-scraped type; `linkedin` no longer scrapes) plus the LLM call (Groq in production; see "Model
selection" above) has to fit inside that window, which is why the Apify poll budget is kept short.

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
