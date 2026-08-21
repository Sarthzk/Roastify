# Roastify — Improvement Tasks

Context: React + Vite app, Vercel serverless function (`api/roast.js`) calling GPT-4o,
Apify for LinkedIn/Instagram scraping, GitHub REST API for GitHub, Upstash Redis for
rate limiting. Live at https://roastify-two.vercel.app/

Work through these roughly in order — each item is scoped to be a self-contained change.
Run `npm run lint` and `npm run build` after each section.

## 1. Critical fixes

- [x] **Remove the debug data leak.** In `api/roast.js`, the handler always returns
  `_debug_scraped_data` and `_debug_scraped_raw` in the JSON response — this ships the
  full raw scrape (GitHub/LinkedIn/Instagram, possibly PII) to the client on every
  request. Strip these fields entirely, or gate them behind
  `process.env.NODE_ENV === "development"`.

- [x] ~~Add fallback roasts for every profile type.~~ **Reversed 2026-08-19 — see Section
  6.** Canned fallbacks turned out to be actively wrong (a user with no forks got told
  about their "dead forks") and hid the real failure rate. All four `defaultXResponse()`
  functions and `FALLBACK_RESPONSES` were deleted; every failure now returns an honest,
  specific error instead — see `api/_lib/errors.js` and the "Error handling" section in
  `CLAUDE.md`.

- [x] **Cap input length before sending to OpenAI.** Scraped bios/about text and
  pasted resume text currently go into the prompt unbounded. Truncate (e.g.
  `.slice(0, 4000)`) before building `userMessageContent`, both to control token cost
  and reduce prompt-injection surface from untrusted profile text. (Length-capping alone
  was never a real injection defense — see Section 6 for the actual fencing/instruction
  work added 2026-08-19.)

- [x] **Tighten LinkedIn/Instagram scrape timing.** The Apify poll loop can take up to
  ~45s (15 attempts × 3s) before the OpenAI call even starts, against a 60s
  `maxDuration`. Either reduce the poll budget, or add a clear "still working" state
  in the UI so a timeout doesn't look like a silent failure.

## 2. Quick UX wins

- [x] **Add Open Graph / Twitter Card meta tags** to `index.html` (`og:title`,
  `og:description`, `og:image`, `twitter:card`). Right now a shared Roastify link has
  no preview — a real miss for a tool whose whole point is sharing the result.
  (**Update 2026-08-19**: `og:image`/`twitter:image` removed — see Section 8. They
  pointed at a `/og-image.png` that never existed; no image-generation capability was
  available to produce a real branded one, so the broken reference was removed rather
  than left dangling. `twitter:card` downgraded from `summary_large_image` to `summary`
  to match — the large-image card type requires an image to render sensibly. A real
  1200x630 image can be added to `public/` later; `og:image`/`twitter:image` should be
  re-added alongside it.)

- [x] **Replace the fake checkbox in `RoastCard.jsx`.** The tip list uses a
  `<label onClick>` + styled `<span>` instead of a real `<input type="checkbox">` —
  fine visually but bad for keyboard/screen-reader users. Swap to a real checkbox
  styled to match.

- [x] **Use `navigator.share()`** in `handleShare` (RoastCard.jsx) when available,
  falling back to the current clipboard-copy behavior. Much better on mobile.

- [x] **Surface the rate limit to the user.** Show remaining roasts (or a cooldown
  timer) against the 5-per-hour Upstash limit instead of only reacting to a 429 after
  the fact.

## 3. Production readiness (do this next, before features)

### Security & abuse prevention
- [ ] Add bot protection (Cloudflare Turnstile or hCaptcha) in front of roast
  submission — without it, anyone can script-hammer `/api/roast` and run up the
  OpenAI + Apify bill regardless of the Upstash rate limit.
- [ ] Set hard spend caps / billing alerts on the OpenAI and Apify accounts directly
  (defense in depth beyond app-level rate limiting).
- [x] Restrict CORS on `api/roast.js` to the production domain only. (**Update
  2026-08-19**: extended to a real allowlist — production origin, this project's Vercel
  preview URLs, and localhost for dev — since a single hardcoded production origin was
  breaking preview deploys entirely. See Section 8.)
- [x] Add `npm audit` (or enable Dependabot) and fix any flagged vulnerabilities.
  (5/6 fixed non-breaking; the last one, a `pdfjs-dist` breaking major-version bump,
  is left for explicit approval — see the note under Section 4/README. **Update
  2026-08-19**: risk explicitly assessed, not fixed — see Section 8. Actual exploit
  requirement — `enableScripting` engaged plus a malicious PDF plus no CSP — doesn't
  match how this app calls the library, and even in the worst case the blast radius is
  a user's own browser tab on a site with no auth/session data worth stealing. Still the
  user's call whether to take the breaking bump.)
- [x] Confirm no secrets are committed to git; add a `.env.example` documenting
  required vars (`OPENAI_API_KEY`, `APIFY_API_TOKEN`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`).

### Observability
- [ ] Add error tracking (e.g. Sentry) in `api/roast.js` in place of bare
  `console.error` calls, so failures surface somewhere you'll actually see them.
- [ ] Add uptime monitoring on the production URL (UptimeRobot / Better Uptime).
- [ ] Set up a simple way to track OpenAI + Apify spend over time (both provide
  usage dashboards — just make sure someone's actually watching them).

### Reliability
- [x] Add retry-with-backoff around the OpenAI, GitHub, and Apify fetch calls
  instead of failing on the first transient error.
- [x] Cache scraped profile data in Redis (short TTL, e.g. 1 hour) keyed by
  `type:identifier`, so re-roasting the same profile at a different severity
  doesn't re-trigger a full Apify run. (**Update 2026-08-19**: TTL is now per-type — 1
  hour for `github` stayed, `linkedin`/`instagram` bumped to 24 hours since those go
  through billed Apify runs and profiles don't change hour to hour. See Section 8.)

### Testing & CI
- [x] Add Vitest unit tests for the pure parsing functions in `api/roast.js`:
  `extractGithubUsername`, `extractInstagramUsername`, `getField`, and the
  LinkedIn/Instagram field-extraction logic — these have the most edge cases and
  the least test coverage risk tolerance.
- [x] Add a GitHub Actions workflow that runs `npm run lint`, tests, and
  `npm run build` on every PR.

### Legal / compliance
- [x] **LinkedIn — decided, resolved 2026-08-21: dropped scraping entirely.** The Apify
  LinkedIn actor never actually worked — its run log showed it received the URL fine but
  failed at fetch with "Unexpected profile response," since LinkedIn blocks
  unauthenticated profile reads. The only working alternative needs a session cookie,
  which is a ToS violation and breaks constantly, so it was never a real option either.
  Replaced with PDF upload/paste (the user exports their own profile via LinkedIn's
  "More → Save to PDF" and uploads it, same mechanism as the resume flow) — no scraping,
  no legal grey area, 100% reliable. See Section 9 and `CLAUDE.md`'s "Request flow".
- [ ] **Instagram — still undecided.** Unlike LinkedIn, Instagram's Apify actor does
  work today, so this is a live decision, not a settled one: keep scraping as-is, add a
  visible disclaimer, or drop Instagram scraping too (its own PDF/upload equivalent
  doesn't really exist — a screenshot upload would need a vision-capable model, a bigger
  change than LinkedIn's swap). Document whichever way this goes (e.g. in the README)
  rather than leaving it implicit.
- [ ] Add a short privacy note on the site covering what's sent to OpenAI/Apify
  and confirming no profile data is persisted server-side beyond ephemeral
  rate-limit counters.

### Documentation
- [x] Expand the README with real setup steps and the `.env.example` reference.

## 4. LLM migration: GPT-4o → open model via OpenRouter

**Superseded 2026-08-19 — see Section 4B below.** OpenRouter and Cohere Command A/R have
been removed entirely. Kept here as historical record of the first migration attempt;
don't use `OPENROUTER_API_KEY` or `cohere/*` model slugs, they no longer exist in this
codebase.

Goal: replace the hardcoded `gpt-4o` call in `api/roast.js` with an open-weight model
via OpenRouter, without losing the savage tone or Hinglish flavor. Evaluate before
cutting over — don't swap blind.

### Setup
- [x] Sign up at openrouter.ai, generate an API key, add `OPENROUTER_API_KEY` to
  Vercel env vars and local `.env`.
- [x] No need to change the `openai` SDK — OpenRouter is OpenAI-compatible, just point
  it at a different base URL:
  ```js
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });
  ```

### Build an eval harness before touching production
- [x] Create `scripts/eval-models.mjs` (a standalone script, not part of the deployed
  app) that runs the exact system prompt from `getSystemPrompt()` against a fixed set
  of ~8 saved profile inputs (mix of GitHub/LinkedIn/Instagram/resume, a couple at
  each severity), across these candidates plus the current `gpt-4o` as baseline:
  - `meta-llama/llama-3.3-70b-instruct` — best all-round pick for tone and
    direction-following; also has a `:free` variant on OpenRouter for early testing
    at no cost.
  - `deepseek/deepseek-v3.2` — cheapest of the group, useful as a cost-floor baseline.
  - `qwen/qwen3-235b-a22b` (confirm the exact dated slug in OpenRouter's model
    picker — Qwen ships multiple versioned variants) — explicitly tuned for creative
    writing/role-play and supports 100+ languages, which matters specifically for the
    Hinglish tips.
- [x] Write each model's output to a file for manual side-by-side comparison — actually
  read them, don't auto-score this part.
- [x] Check specifically: does "destroy me" stay savage, do the tips keep the Hinglish
  flavor, and does the model reliably return valid JSON matching `{ roast, tips }`?
  Log JSON-parse failures per model — this varies more by model than people expect.

### Roll out only after the eval
- [x] Once a model won the eval (Cohere Command A / Command R, not the original
  Llama/DeepSeek/Qwen shortlist — see `MODEL_OPTIONS` in `api/roast.js`), it was wired
  in — but as a **user-facing model picker alongside GPT-4o**, not a silent swap with an
  automatic fallback. GPT-4o stays selectable for side-by-side comparison; there's no
  cross-model fallback-on-parse-failure (each model's own request either succeeds or
  hits the type's canned fallback, same as any other failure — see architecture notes
  in `CLAUDE.md`).
- [ ] Run in shadow mode first if possible (log both outputs, serve only the current
  model to users) before flipping production traffic over. *(Superseded by the picker
  approach above — not applicable unless a future hard cutover is decided.)*

Note: OpenRouter is pay-per-token with no subscription — credits don't expire, so
there's no minimum spend while you're just running the eval.

## 4B. Provider swap: OpenRouter/Cohere → Groq, production pinned to one free model

Goal: drop OpenRouter/Cohere entirely, move to Groq (free tier — no credit card,
rate-limited rather than metered) as the sole production model, and stop letting
production users pick a model at all — the picker becomes a dev-only tool.

- [x] Remove OpenRouter entirely: `command-a` / `command-r` out of `MODEL_OPTIONS`, the
  `"openrouter"` branch out of `getClient()` / `getRequiredApiKey()`, `OPENROUTER_API_KEY`
  out of `.env.example` / `README.md` / `CLAUDE.md`, `scripts/eval-models.mjs` retargeted
  to Groq candidates. Repo-wide grep for openrouter/cohere/command-a/command-r confirmed
  clean (aside from this file's own historical Section 4 record and this section's name).
- [x] Add a `"groq"` provider to `api/roast.js` using the same registry/`getClient`
  pattern as `"openai"` (no special-casing) — `baseURL: "https://api.groq.com/openai/v1"`,
  key from `GROQ_API_KEY`.
- [x] Add `gpt-oss-120b` → `openai/gpt-oss-120b` as the new `DEFAULT_MODEL_KEY`. **Not**
  `llama-3.3-70b-versatile` as originally requested — that model was deprecated by Groq
  (announced 2026-06-17, shut down 2026-08-16, already past by the time this ran).
  `openai/gpt-oss-120b` is Groq's own recommended replacement, confirmed on the free tier
  via `console.groq.com/docs/deprecations` and `/docs/rate-limits` before hardcoding.
- [x] Kept `gpt-4o` in the registry as a dev-only comparison option (`NODE_ENV=development`).
- [x] **Production model pinning (the actual security boundary)**: added
  `resolveProductionSafeModelOption(modelKey, nodeEnv)` in `api/roast.js` — outside
  `NODE_ENV === "development"` it ignores `req.body.model` entirely and always resolves
  to `DEFAULT_MODEL_KEY`. The handler calls this instead of `resolveModelOption` directly,
  passing `process.env.NODE_ENV`. Client-side, `InputForm.jsx`'s model picker only renders
  when `import.meta.env.DEV`, and `App.jsx` / `src/lib/openai.js` don't send a `model`
  field at all when it's hidden — but that's UX, not enforcement; a modified client still
  can't get anything but `gpt-oss-120b` in production because the server ignores it.
  `RoastCard.jsx`'s "modelUsed" label is also gated behind `import.meta.env.DEV`.
- [x] Unit tests: `resolveModelOption` updated for the new 2-entry registry; new
  `resolveProductionSafeModelOption` tests cover the pinning logic directly, including
  "a client requesting gpt-4o with NODE_ENV unset resolves to the Groq default."
- [x] **Ran the eval harness against the model actually shipped** (`node
  scripts/eval-models.mjs`, all 8 fixtures): `openai/gpt-oss-120b` scored 0/8 JSON parse
  failures, "destroy me" stayed genuinely savage, tips kept the Hinglish flavor. (For
  reference: `gpt-4o` also 0/8, `gpt-oss-20b` 2/8, `qwen3.6-27b` 8/8 — confirms
  `gpt-oss-120b` was the right pick over the alternate `qwen3.6-27b` replacement.)
- [x] **Found and fixed a real streaming regression**: a live SSE curl test showed the
  Groq default arriving as one giant `roast` frame instead of incrementally. Root-caused
  by logging raw stream chunks directly against Groq — `response_format: json_object`
  makes gpt-oss buffer its entire response server-side (reasoning streams fine token-by-
  token under a separate `delta.reasoning` field with `channel: "analysis"`, which our
  code already correctly ignores; the final `delta.content` arrives as a single atomic
  chunk under JSON mode). Two experiments confirmed the fix: dropping `response_format`
  restored real token-by-token streaming (482 content chunks vs. 1), and re-running all 8
  fixtures twice without it still held at 0/8 parse failures (17/17 clean JSON across
  every sample taken). `reasoning_effort: "low"` also added for Groq — cuts the invisible
  reasoning phase from ~1.8s to ~500ms and reduces reasoning-token spend against the
  free-tier rate limit. New `buildCompletionParams()` in `api/roast.js` encodes this
  per-provider split (kept for `gpt-4o`, dropped for `groq`); `scripts/eval-models.mjs`
  mirrors the same split so the harness stays honest with production. Verified for real
  against the actual running handler afterward: 365 incremental `roast` frames growing
  word-by-word, then one `complete` event, no parse-failure logs.
- [x] Since prompt-only JSON enforcement isn't a hard guarantee the way `response_format`
  is, added explicit `[roast-json-parse-failure]` / `[roast-invalid-format]` log lines
  (model/type/severity/buffer preview) so a future reliability regression shows up in
  logs instead of silently vanishing into the generic canned fallback. 2 new tests cover
  `buildCompletionParams`'s per-provider param split.

## 5. Feature ideas (pick what's interesting — later)

- [ ] Roast history saved to `localStorage` so past roasts aren't lost on refresh.
- [x] Persona picker beyond "Ricky Gervais" — see Section 7. Shipped 3 selectable
  personas (cynic/recruiter/desi-uncle), not 2, with the prompt layer restructured to
  support them.
- [x] Stream the roast token-by-token (SSE) instead of waiting for the full JSON blob.
- [ ] "Redemption mode" — after checking off tips, let the user re-submit and see if
  the roast softens.
- [ ] X/Twitter profile support alongside GitHub/LinkedIn/Instagram/resume.

## 6. Honest error handling + prompt injection defense (2026-08-19)

Goal: replace the canned-fallback-on-any-failure behavior (Section 1) with real, specific
errors the client can distinguish from a genuine roast, and close the prompt-injection
gap left open by length-capping alone (Section 1).

### Honest errors, no silent fallback
- [x] Deleted `defaultGithubResponse` / `defaultLinkedInResponse` /
  `defaultInstagramResponse` / `defaultResumeResponse` / `FALLBACK_RESPONSES` entirely —
  not repurposed, gone. Every failure path now returns a real error instead.
- [x] New `api/_lib/errors.js` (zero dependencies, importable from the frontend bundle
  too): `ERROR_CODES` map, a `RoastError` class carrying `code`/`status`/`retryable`/
  `cause`, and `toErrorEnvelope()` — the one `{ error: { code, message, retryable } }`
  shape used for both JSON responses and SSE `error` frames.
- [x] Every scraper `throw new Error(...)` converted to `throw new RoastError(...)` at
  its exact original site, keeping the exact same user-facing message, with a status
  code chosen per scenario: 400 `SCRAPE_INVALID_INPUT`, 404 `SCRAPE_NOT_FOUND`, 502
  `SCRAPE_UPSTREAM_FAILURE`, 504 `SCRAPE_TIMEOUT` (Instagram only — LinkedIn's analogous
  poll-exhaustion case maps to `SCRAPE_NOT_FOUND` instead, since its message frames it as
  a check-your-input problem, not a timeout).
- [x] Split the LLM call into two phases with different failure handling: the
  `chat.completions.create()` promise is awaited *before* SSE headers are sent, so a
  setup failure (bad key, network error, provider outage) still gets a real HTTP status
  (`LLM_UPSTREAM_FAILURE`, 502) instead of silently becoming a fake `complete` event.
  Only once the stream object is in hand do headers commit to SSE — everything after
  that (mid-stream drop, `LLM_EMPTY_RESPONSE`, `LLM_PARSE_FAILURE`, `LLM_INVALID_FORMAT`)
  sends an `event: error` SSE frame instead.
- [x] Structured logging: `logFailure()` writes one `JSON.stringify`'d line per failure
  with `code`/`type`/`model`/`message` — never the scraped profile content or resume
  text (no PII). `LLM_PARSE_FAILURE` / `LLM_INVALID_FORMAT` additionally log the raw
  model buffer (truncated to 2000 chars), the deliberate real-world signal for how often
  prompt-only JSON enforcement (Section 4B) actually fails.
- [x] Client: `src/lib/openai.js`'s `getRoast`/`consumeRoastStream` parse the new
  envelope for both the JSON and SSE `error` paths into one consistent thrown `Error`
  shape (`.message`, `.code`, `.retryable`, `.rateLimit`). `App.jsx` shows the real
  message (not "Something went wrong"), clears any partial roast a mid-stream failure
  left behind, and renders a "try again" button only when `err.retryable` is true (429s
  are deliberately non-retryable — the existing rate-limit countdown UI already tells the
  user when to come back; a generic retry button would just 429 again immediately).
- [x] Tests: error-code mapping for the exported pure functions and for
  `toErrorEnvelope()`, plus a handler-level test (mocked req/res, no real network calls)
  confirming a scrape failure produces the error envelope with a real HTTP status and
  — explicitly — no top-level `roast`/`tips` fields, i.e. not a canned roast.
  `vite.config.js` gained a `test.env` block (dummy `GROQ_API_KEY` / `UPSTASH_*`) so this
  is hermetic and doesn't depend on a developer's real local `.env`; the rate-limiter
  module is mocked in tests to fail open instantly instead of eating several real seconds
  retrying against a bogus Upstash URL.

### Prompt injection fencing
- [x] New `fenceUntrustedContent()` in `api/roast.js`: generates a fresh random hex
  marker per request (`crypto.randomBytes(8)`) and wraps content as
  `<<<PROFILE_DATA_<hex>>>> ... <<<END_PROFILE_DATA_<hex>>>>`. The marker is unpredictable
  at scrape time (generated after the content was written), so attacker-controlled text
  can never legitimately contain today's exact closing fence.
- [x] Strips any fence-*shaped* substring already present in the content as defense in
  depth, in case someone tries to fake a boundary.
- [x] New shared `UNTRUSTED_DATA_NOTICE` instruction, interpolated into all 4
  `getSystemPrompt()` templates: content inside the fence is inert data describing the
  person being roasted, never instructions to follow (regardless of what it claims to
  be), and any instructions found inside it should themselves be roasted, not obeyed.
- [x] Applied to all four profile types uniformly (including pasted/PDF-extracted resume
  text) via the single `userMessageContent` variable, **after** `MAX_INPUT_LENGTH`
  truncation — truncating first so the closing fence can never get cut off.
- [x] Tests: fence structure (matching open/closing markers), marker uniqueness across
  calls, stripping of pre-existing fence-shaped content (both hex and bare forms), and a
  well-formed closing fence at the full 4000-char `MAX_INPUT_LENGTH`.
- Manual verification (live model call, not run by Claude — see `WORK_LOG.md` for the
  curl command) still pending: confirm the model actually ignores an injection attempt
  in a real scraped bio rather than just trusting the prompt instruction in the abstract.

## 7. Persona system + prompt layer restructure (2026-08-19)

Goal: replace the single hardcoded "Ricky Gervais" voice with three selectable personas,
without letting the prompt layer grow into 12 near-duplicate templates (4 types x 3
personas) — restructure to composed fragments first, then add personas as data.

### Prompt layer restructure
- [x] Deleted the 4 near-identical `getSystemPrompt()` template literals in `api/roast.js`
  (duplicated tone/severity/tips/untrusted-notice content across each) in favor of
  composing named fragments — new `api/_lib/prompts/` module: `base.js` (app framing +
  output contract), `types.js` (per-type "what to look at"), `severity.js` (intensity,
  unchanged, relocated), `untrustedDataNotice.js` (unchanged, relocated, reused not
  duplicated), `personas.js` (registry, see below), and `index.js` (the composer).
- [x] `getSystemPrompt(type, severity, personaId)` stays the exported entry point via
  `api/roast.js` (re-exported from `./_lib/prompts/index.js`) — `scripts/eval-models.mjs`
  didn't need its import path changed.
- [x] Regression safety net: a test asserting the composed `(github, medium, cynic)`
  prompt still contains every key instruction (verbatim substrings) the old hardcoded
  github prompt had — see `api/_lib/prompts/index.test.js`. One line (the output-contract
  sentence) was deliberately reworded during the move to `base.js`; the test checks for
  the JSON shape itself there, not the exact old sentence, since rewording it wasn't a
  regression.
- [x] Test: the untrusted-data notice is present in every type x persona combination
  (12 combos) and across all 3 severities for one representative combo.

### Persona registry
- [x] `api/_lib/prompts/personas.js` follows the exact `MODEL_OPTIONS` +
  `resolveModelOption` pattern: `PERSONAS` (plain-data registry), `DEFAULT_PERSONA_ID`
  ("cynic"), `resolvePersona(personaId)` (pure, falls back to default for
  unknown/missing input — same validation discipline as `severity` and `model`), plus a
  new `isPersonaAllowedForType(persona, type)` pure helper for the allowedTypes
  enforcement below.
- [x] Three personas, each `{ id, name, tagline, promptFragment, allowedTypes }`:
  - **`cynic`** (default) — the existing voice, extracted as-is, not rewritten (the
    current tone is the product's identity and it evals well): Gervais/Golden-Globes
    framing, "I don't care," "Truly pathetic," mortality references, 5-10% Hinglish.
  - **`recruiter`** — savage but professionally framed, a pass/fail hiring evaluation
    ("I'd pass on this in eight seconds, here's why"), no jokes, no nihilism, no
    Hinglish, evidence-based (cites exact repo names/titles/buzzwords from the profile).
    Tips are meant to be the most concrete of the three — exact rewrites, not general
    advice.
  - **`desi-uncle`** — comparison-based roasting against an imagined more-successful
    relative ("Sharma ji ka beta" energy), disappointed rather than cruel, heaviest
    Hinglish of the three. Carries an explicit, mandatory guardrail line in its own
    fragment: must land as funny, never as genuinely demeaning about family, caste,
    class, or background.
- [x] `allowedTypes` is all 4 profile types for all 3 personas currently, but the field
  is real and enforced server-side regardless (`isPersonaAllowedForType`, checked in the
  handler right after the model/key check, before rate limiting or scraping) — ready for
  a future persona (e.g. a debate-mode voice) that isn't valid for a straight profile
  roast, without needing a second enforcement pass added later.
- [x] Tests: `resolvePersona` (unknown id, missing id, defaults to cynic specifically,
  every registered persona has the full expected shape) and `isPersonaAllowedForType`
  (true for every real persona x every current type; a synthetic restricted-persona
  fixture to prove the enforcement logic itself works correctly today, since no shipped
  persona is actually restricted yet) — see `api/_lib/prompts/personas.test.js`.

### Wired through
- [x] Handler (`api/roast.js`): accepts `persona` in the request body, resolves it very
  early (pure, no dependency on url/type), validates `allowedTypes` and rejects a
  violating combination with a new `PERSONA_NOT_ALLOWED_FOR_TYPE` error code (400) —
  added to `ERROR_CODES` in `api/_lib/errors.js`. The resolved persona id is included in
  the `complete` SSE event and in every structured failure log alongside `model` and
  `type` (`logFailure()` signature extended).
- [x] Client: new persona picker in `InputForm.jsx` (always visible, unlike the dev-only
  model picker — persona is a real production feature), styled to match the existing
  Severity/Model pickers but showing name + tagline per option (stacked, not just a
  short label, since taglines are longer). New `src/lib/personas.js` mirrors the backend
  registry (`{ value, name, tagline }`) rather than cross-importing across the
  frontend/backend boundary, matching how `InputForm.jsx`'s `models` array already
  mirrors `MODEL_OPTIONS`. `App.jsx` sends `persona` on every request (unlike `model`,
  always sent when set — no dev gating) and resolves the id the `complete` event carries
  back into a display name for `RoastCard`, which now shows it next to "roast output"
  unconditionally (`modelUsed` stays dev-only).

### Eval harness
- [x] `scripts/eval-models.mjs` gained a persona dimension without multiplying
  `scripts/eval-fixtures.mjs`'s 8 fixtures by 3: each fixture's existing model-comparison
  section (unchanged, still defaults to cynic) is now followed by a persona-comparison
  section — the same fixture run across all 3 personas, against the production default
  model only (not the full model x persona matrix), written into the same per-fixture
  Markdown file. Explicitly flags what to check per fixture: whether `recruiter` stays
  useful at `mild`, whether `desi-uncle` stays funny at `destroy me`, and whether `cynic`
  changed at all versus the model-comparison section above (it shouldn't — same fragment
  content, same default persona; this is the refactor's regression check for real model
  output, not just prompt text).
- Not run by Claude, per instruction — the user will run `node scripts/eval-models.mjs`
  and read the three voices themselves.

## 8. Cleanup pass: split `api/roast.js`, dead weight, design tokens (2026-08-19)

Goal: get the codebase ready for auth + Postgres without making anything worse first.
No new features, no behavior changes (aside from the CORS/cache-TTL/og-image items,
which were explicitly requested behavior fixes, not refactor side effects).

### Split `api/roast.js` (~935 lines → ~310)
- [x] Moved each scraper into `api/_lib/scrapers/`: `github.js`, `instagram.js`,
  `linkedin.js`. The Apify run-start/poll/dataset-fetch sequence, previously
  near-duplicated between Instagram and LinkedIn, is now shared via
  `runApifyScrape()` in `api/_lib/scrapers/apify.js` — parameterized just enough to
  preserve one real behavioral difference between the two callers rather than silently
  fixing (or duplicating) it: LinkedIn throws immediately on a failed poll-status
  check; Instagram silently keeps polling until it runs out of attempts.
- [x] Moved `extractStreamingRoastText` and the SSE helper (`sendSseEvent`) into
  `api/_lib/streaming.js`.
- [x] `api/roast.js` now holds the handler, model-selection logic, and the
  handler-private `logFailure()` — model-selection (`MODEL_OPTIONS`,
  `resolveModelOption`, etc.) and `logFailure()` weren't named in the task's explicit
  move list and aren't separable "concerns" the same way scraping/streaming were (model
  selection is core handler business logic; `logFailure` is tightly coupled to the
  handler's own catch sites), so they stayed rather than being extracted speculatively.
- [x] Every previously-exported symbol still exported from somewhere sensible.
  `getSystemPrompt`/`PERSONAS` stay re-exported from `api/roast.js` specifically because
  `scripts/eval-models.mjs` imports them from there (a real external contract);
  everything else (scrapers, streaming, fencing) has no consumer beyond `api/roast.js`
  itself, so it's imported directly from its real module instead of also re-exported —
  otherwise `api/roast.js` would still be acting as a re-export hub, working against the
  goal. `scripts/eval-models.mjs` needed zero import changes as a result (confirmed —
  none of what it imports moved).
- [x] Tests split to match, colocated with their new modules (matching the existing
  `api/_lib/prompts/*.test.js` pattern from the persona refactor) rather than staying in
  one growing `api/roast.test.js`: `api/_lib/scrapers/{github,instagram,linkedin}.test.js`,
  `api/_lib/streaming.test.js`. `api/roast.test.js` keeps only what still tests things
  that live there: fencing (import path updated), model-selection, and handler-level
  integration tests.
- [x] Pure move-and-consolidate, verified: live curl checks against the actual running
  handler (validation-path only — invalid input, persona/type combos) produced
  byte-identical error envelopes and structured logs before and after the split.

### Dead weight audit
- [x] **Deleted `extractPostImageUrls`** (`api/roast.js`, moved-then-deleted rather than
  moved to `api/_lib/scrapers/instagram.js`) and its 4 tests. It computed Instagram post
  image URLs that nothing ever consumed — `scrapeInstagram`'s returned object had an
  `imageUrls` field, but the handler only ever reads `.text` from it. Also dropped the
  now-pointless `imageUrls` field from `scrapeInstagram`'s return value.
- [x] **Deleted `export` from `RATE_LIMIT_WINDOW`** (`api/_lib/rateLimit.js`) — it's used
  internally by `createRatelimit()` but nothing outside the file ever imported it;
  `RATE_LIMIT_MAX` stayed exported since `api/rate-limit-status.js` genuinely imports it.
- [x] **Merged 4 over-fragmented prompt files into one**: `api/_lib/prompts/base.js`
  (8 lines), `types.js` (14), `severity.js` (8), `untrustedDataNotice.js` (7) — all the
  same concern (static prompt fragment text) split across 4 tiny files for no reason —
  merged into `fragments.js`. Content unchanged, just relocated.
- [x] Reviewed the existing test suite for tests asserting implementation detail rather
  than behavior; found one worth a second look (the "prompt-layer re-exports from
  api/roast.js" test, which pins an *import path* rather than user-facing behavior) but
  judged it legitimate — it protects a real external contract
  (`scripts/eval-models.mjs`'s imports), not an arbitrary internal detail, so it stayed.
  No tests removed for asserting implementation detail; the ones removed were removed
  because their subject (`extractPostImageUrls`) was deleted, not because the tests
  themselves were bad.
- Net effect on `api/_lib/prompts/`: 6 non-test files before (4 fragment files +
  `personas.js` + `index.js`) → 4 after (`fragments.js`, `personas.js`, `fence.js`,
  `index.js`) — even after absorbing `fenceUntrustedContent` (previously in
  `api/roast.js`, not counted in the original 6).

### Design tokens
- [x] Extracted the color palette into CSS custom properties in `src/index.css`'s
  `:root` — 3 already existed (`--color-bg-primary`, `--color-bg-tertiary`,
  `--color-text-primary`, `--color-text-secondary`, `--color-accent`, `--color-border`,
  `--font-family`) but were only used in `src/index.css` itself, never referenced from
  the component files that actually needed them; added the missing ones
  (`--color-bg-surface`, `--color-bg-hover`, `--color-text-muted`,
  `--color-accent-hover`) and removed one genuinely dead token (`--color-bg-secondary:
  #111111` — declared, never referenced anywhere, not even before this pass).
- [x] Replaced every hardcoded hex literal across `App.jsx`/`InputForm.jsx`/
  `RoastCard.jsx` with the matching `var(--color-*)` reference — inline `style={{}}`
  objects, imperative `element.style.x = "..."` hover-state assignments, a raw
  `<style>{...}</style>` block, and Tailwind arbitrary-value brackets
  (`text-[var(--color-text-secondary)]` — confirmed Tailwind v4 compiles `var()` inside
  `[...]` straight through to real CSS by inspecting the built output, not just
  assuming). One deliberate exception, documented inline:
  `RoastCard.jsx`'s `handleSaveAsImage()` passes a literal hex to `html2canvas`'s
  `backgroundColor` option, which becomes a canvas `fillStyle` — canvas doesn't resolve
  CSS custom properties, so that one value has to stay literal and be kept in sync with
  `--color-bg-surface` by hand.
- [x] Pixel-identical by construction — a CSS custom property resolves to exactly its
  declared value, so this is provably a token extraction, not a redesign. Verified via
  `npm run build` (compiles cleanly, no errors) and inspecting the generated CSS output
  directly to confirm each token-referencing rule resolves to the same value as the
  literal it replaced.

### Small backlog items
- [x] **CORS allowlist**: `api/_lib/cors.js` no longer hardcodes a single production
  origin — `applyCors(req, res)` now reflects `Access-Control-Allow-Origin` back only
  when the request's `Origin` matches the production domain, this project's Vercel
  preview URLs (`roastify-two-<slug>.vercel.app`), or `localhost:<any port>`. New
  `api/_lib/cors.test.js` covers the allowlist directly, including a spoofing attempt
  (`https://roastify-two.vercel.app.evil.com`) that must still be rejected.
- [x] **Per-type scrape cache TTL**: `api/_lib/scrapeCache.js`'s single 1-hour constant
  became a per-type lookup — `github` stays 1 hour (free API), `linkedin`/`instagram`
  bumped to 24 hours (billed Apify runs, slow-changing profiles). New
  `api/_lib/scrapeCache.test.js` mocks the Redis client to assert the exact TTL passed
  per type.
- [x] **`og:image`**: removed, rather than fabricated. `index.html` referenced
  `/og-image.png`, which never existed in `public/`. No image-generation capability was
  available to produce a real 1200x630 branded image in this environment, and inventing
  one felt like scope creep beyond a cleanup pass — so the broken `og:image`/
  `twitter:image` references were removed instead, and `twitter:card` downgraded from
  `summary_large_image` (which requires an image) to `summary`. A real image can be
  added to `public/` later, with the tags re-added alongside it.

### pdfjs-dist advisory — flagged, not fixed
- [x] Checked the current advisory (GHSA-hq66-cqwq-w95j / CVE-2026-16633): arbitrary JS
  execution when PDF.js opens a malicious PDF, *if* `enableScripting` is engaged (PDF.js's
  own embedded-JavaScript sandbox escaping into the hosting page's origin) *and* there's
  no CSP blocking script-src. Affects `pdfjs-dist` 5.6.83–6.2.107; fixed in 6.2.108 (the
  `npm audit fix --force` target — a major version bump).
- **Actual risk here, given the usage**: `InputForm.jsx`'s `extractPdfText()` only calls
  `getDocument({ data })` → `getPage(n)` → `getTextContent()` — the low-level parsing
  API. It never touches PDF.js's viewer/scripting-manager layer, which is what actually
  wires up and executes a PDF's embedded JavaScript; text extraction alone doesn't
  appear to engage `enableScripting` at all. Even in an unverified worst case, this all
  runs entirely client-side, in the browser of whoever uploads their own resume — there's
  no server-side PDF processing, and the app has no auth/session/cookie data on that
  origin worth an attacker stealing. This isn't "verified safe by testing," just a
  reasoned assessment from how the library is actually called — worth a real test before
  treating it as settled.
- **Migration effort if upgraded**: this codebase's usage already passes a parameter
  object to `getDocument()` (not the removed bare-URL call form) and never calls the
  removed `PDFDocumentProxy.prototype.destroy()`, so two of 6.0's headline breaking
  changes don't apply here. Main things to verify before upgrading: the `?url`-imported
  worker file (`pdfjs-dist/build/pdf.worker.min.mjs`) still exists at that exact path in
  6.x's package layout, and the "minimum supported browsers" bump doesn't matter for
  this app's actual target audience. Likely low-to-moderate effort, but should be tried
  in a branch and verified, not assumed.
- Not upgraded — left for explicit approval, per instruction.

## 9. Replace LinkedIn scraping with LinkedIn PDF upload (2026-08-21)

Goal: the Apify LinkedIn actor never actually worked (run log: receives the URL fine,
fails at fetch with "Unexpected profile response" — LinkedIn blocks unauthenticated
profile reads), and the only working alternative needs a session-cookie, a ToS violation
that breaks constantly. Drop LinkedIn scraping entirely; replace it with the user
exporting their own profile PDF ("More" → "Save to PDF") and uploading it, exactly like
the existing resume flow. Net deletion, not a feature add.

- [x] **Deleted the LinkedIn scraper**: `api/_lib/scrapers/linkedin.js` and its tests
  removed entirely — `extractLinkedInSlug`, `getField`, and all Apify field-mapping logic
  (fullName/headline/about/experience/education/skills extraction) had no other caller,
  confirmed via a repo-wide grep before deleting. `linkedin` removed from
  `api/_lib/scrapeCache.js`'s per-type TTL map (nothing left to cache).
- [x] **Simplified `runApifyScrape()`** (`api/_lib/scrapers/apify.js`) now that Instagram
  is its only caller: removed the `statusCheckFailureMessage` parameter and its
  conditional branch, which existed solely to preserve LinkedIn's throw-immediately
  behavior against Instagram's silent-retry behavior — with only one caller left (which
  never passed that param), the branch was dead code. The function now always silently
  retries a failed status check, matching what Instagram already did. Kept in its own
  module regardless — it's still a distinct concern (Apify's HTTP run/poll/dataset
  protocol) from Instagram's own field-extraction logic, not just a single-use function
  worth inlining.
- [x] **`api/roast.js`**: removed the `linkedin` scrape branch entirely — `linkedin` now
  behaves exactly like `resume` always has (the request body's `url` field carries the
  pasted/PDF-extracted text as-is, `profileData` just stays that string, no scraping, no
  cache). The `linkedin` `TYPE_FRAGMENTS` prompt fragment (buzzwords, professional
  facade) is untouched — the content being roasted still differs from a resume even
  though the input mechanism is now identical.
- [x] **Client**: `InputForm.jsx`'s resume-only upload UI (file input + paste textarea)
  now renders for both `resume` and `linkedin` (`isUploadType = type === "resume" ||
  type === "linkedin"`) — extracted once rather than duplicated, since it was already a
  single conditional branch in one component, not two separate implementations. Shared
  state/handlers renamed from resume-specific names (`resumeText`/`resumeStatus`/
  `handleResumeFileChange`) to generic ones (`pastedText`/`uploadStatus`/
  `handleFileChange`) to match what they now actually do.
- [x] **UI hint**: a one-line hint ("Open your LinkedIn profile → More → Save to PDF,
  then upload it here.") renders above the upload UI only when `type === "linkedin"`,
  styled like the existing status-line helper text — no modal, no tooltip component.
- [x] **Error handling, both fixed together** (task explicitly asked to check whether the
  resume path already handled this — it didn't, for either): (1) server-side, the
  handler's missing-input check changed from a bare truthiness check to a trimmed one
  (`!String(url || "").trim()`), so a whitespace-only submission — what a failed/empty
  extraction would produce if the client-side guard were ever bypassed — now gets the
  real `MISSING_INPUT` `RoastError` instead of silently reaching the model with blank
  content; (2) client-side, `InputForm.jsx`'s `handleFileChange()` (formerly
  `handleResumeFileChange()`) no longer swallows extraction failures in a bare `catch
  {}` — an unreadable file, an unsupported file type, or a PDF with no extractable text
  all now set a visible `uploadError` message instead of the upload silently doing
  nothing.
- [x] **Tests**: `linkedin.test.js` deleted (not skipped — its subject no longer exists).
  New handler-level regression test spies on `global.fetch` (with the `openai` package
  mocked to reject immediately, avoiding both a real network call and the SDK's own
  retry backoff) and asserts a `linkedin`-type request never calls anything at
  `apify.com`, while confirming the request still reached the LLM-call step — proving
  the absence of an Apify call is meaningful, not just "nothing ran." A second new test
  covers the whitespace-only-input fix directly. `npm test` — 87/87 (95 baseline − 9
  deleted `linkedin.test.js` tests − 1 deleted scrapeCache linkedin-TTL test + 2 new).
  `npm run lint` and `npm run build` both clean.
- [x] **Docs**: README's feature list and env var table updated (LinkedIn is PDF
  upload/paste now, not a URL; `APIFY_API_TOKEN` is Instagram-only); `.env.example`
  comment updated to match; `CLAUDE.md`'s "Request flow" restructured around the two
  input mechanisms (scraped: github/instagram; uploaded: linkedin/resume) rather than
  four uniform per-type branches, plus the "Error handling", "Rate limiting & caching",
  "Frontend structure", and "Deployment" sections updated wherever they referenced
  LinkedIn scraping specifically. This section's own checklist items above 4 in
  "Legal / compliance" annotated to point here.
- Net effect: one file deleted (`linkedin.js`, 164 lines) plus its test file (43 lines,
  9 tests) deleted; `apify.js` net shorter (one parameter and its branch removed);
  `scrapeCache.js` one map entry shorter. `api/roast.js` lost an import and a branch. The
  only net-new code is the client-side upload UI becoming type-agnostic (a rename plus a
  small conditional, not new logic) and the two test additions — a real net deletion
  overall, as intended.

## 10. Visual redesign (Claude Design v2 handoff) + Instagram kill switch (2026-08-21)

Goal: implement a full presentation-layer redesign from a Claude Design handoff (read via
the DesignSync MCP tool) — same product, same API contract, only the look changes — plus
an `INSTAGRAM_ENABLED` kill switch since it touches the same source picker.

### Redesign
- [x] Read the authoritative bundle (`Roastify Enhanced v2.dc.html` + its README) directly
  rather than trusting the superseded v1 handoff bundled alongside it (factually wrong:
  GPT-4o in header/footer, no persona picker, URL-only input, no error state) — deleted
  the v1 `README.md` from the design project so it can't be mistakenly followed later.
- [x] Full-bleed gutter-grid layout implemented as plain CSS classes + real `@media`
  queries in `src/index.css` (not the prototype's `!important`/`data-r` streaming hack),
  using the handoff's own `data-r="x"` → `.x` naming crib. All four breakpoints
  (1180/900/600/380px) transcribed verbatim from the design source.
- [x] Component boundaries moved to match the handoff's file-mapping table: submit button
  + progress rule + rate strip moved from `InputForm.jsx` into `App.jsx`; `RoastCard.jsx`
  now owns all four Output states (idle/streaming/error/complete) instead of only the
  completed roast. See `CLAUDE.md`'s "Frontend structure" for the full breakdown.
  Source list reordered (`github → instagram → linkedin → resume`) so the two URL sources
  and the two PDF sources are each adjacent, per the handoff.
- [x] Real HTML5 drag-and-drop added to the upload zone (previously click-to-browse only),
  sharing one `processFile()` with the existing file-input path rather than duplicating
  extraction/validation logic.
- [x] Streaming "stage" label — the handoff's prototype drives this with a fake timer
  cycling through GitHub-flavored copy ("counting abandoned repos…"). Resolved with the
  user during planning: replaced with a value derived from real stream lifecycle instead
  (no roast text yet vs. tokens arriving) — two real states, two static labels, no timer,
  no wrong-domain copy on non-GitHub roasts.
- [x] New error "detail" line (a UI element the old design didn't have) synthesized from
  real data only: a real countdown for rate-limit errors, the checked source type for
  scrape errors (never raw submitted text), a plain machine code otherwise. No fabricated
  per-error-code action phrasing — the retry button stays "try again" for anything
  retryable, per what the backend envelope actually provides.
- [x] Checkbox glyph switched from an inline SVG to the literal `✓` text character, per
  the design's "no icon fonts, no SVG" rule; the underlying visually-hidden real
  `<input type="checkbox">` accessibility technique is unchanged.
- [x] Dropped `showSlowNotice`/`SLOW_SCRAPE_TYPES` (the old "still scraping" text) as dead
  weight — the redesign's real streaming stage label already covers it, and the design
  has no slot for a second, separate notice.
- [x] Old `--color-*` CSS token set removed entirely (confirmed unreferenced via grep
  before deleting), replaced by the new `--ground-*`/`--ink-*`/`--rule-*`/`--accent*` set
  copied verbatim from the handoff.
- [x] Tests: no frontend test suite exists (vitest only covers `api/**/*.test.js`), so
  this pass touched zero existing tests — confirmed 87/87 backend tests still pass
  unmodified (aside from the kill-switch item below).
- [x] **Manually verified live** in a real browser (desktop, real Groq/Apify/Upstash
  credentials): idle, a real error (invalid GitHub handle → synthesized detail line
  matching spec), a real streaming roast (watched the derived-from-lifecycle stage label
  and live char count update against actual Groq tokens), complete (meta row, working fix
  checklist), and "roast another" reset. **Mobile breakpoints not manually verified** —
  the available browser-resize tooling didn't actually shrink the rendering viewport in
  this sandboxed environment; the `@media` rules are a verbatim transcription of the
  handoff's own source, but a real responsive-mode check is still owed to the user.

### Instagram kill switch
- [x] `api/_lib/config.js`'s `isInstagramEnabled()` (`INSTAGRAM_ENABLED !== "false"`, same
  boolean-string convention as `NODE_ENV`), a new `SOURCE_UNAVAILABLE` error code, and an
  early-exit check in `api/roast.js` (before rate limiting is consumed) rejecting a
  disabled Instagram request with a 503.
- [x] `api/rate-limit-status.js` reports `instagramEnabled` in all three response shapes,
  reusing the endpoint the frontend already polls on page load rather than adding a new
  one. `InputForm.jsx` hides the Instagram source card when disabled; `App.jsx` merges
  (not replaces) the flag into `rateLimitStatus` so a later roast response doesn't
  silently un-hide it.
- [x] Tests (additive): `api/_lib/config.test.js`, new `api/roast.test.js` handler tests,
  and `api/rate-limit-status.test.js` coverage (2 pre-existing assertions there needed
  updating for the new response field — an intentional, in-scope shape change, not a
  regression). 95/95 total passing. `npm run lint` and `npm run build` both clean.

## 11. Auto-scroll to Output, actually fixed (2026-08-21)

- [x] Auto-scroll to the Output section wasn't actually working, despite being
  implemented and reportedly verified in the prior session. Root cause, confirmed
  empirically: the scroll fired once, synchronously, at submit time — measuring the
  Output section's position while the page was still short (idle state). `window.
  scrollTo` clamps its target to the page's height *at the moment it's called*; it
  doesn't keep advancing as streamed content grows the page taller afterward. The
  original implementation's own "verification" last session only ever exercised the
  math/positioning logic with instant scrolling in a test harness where `behavior:
  'smooth'` doesn't animate at all — it never actually confirmed the shipped smooth
  version scrolled to a *useful* final position once real content existed.
  Fix (`src/App.jsx`): two scroll triggers instead of one — (1) as soon as there's
  anything to see (first streamed chunk, or an immediate error), gated to fire once per
  request; (2) once more when the request reaches a terminal state (complete or error),
  by which point the page has grown to its real final height, correcting for whatever
  the first, early scroll's clamped target undershot. Verified for both a fast (GitHub)
  and slow (Instagram) roast, and for a fast error — in all cases the final scroll
  position landed exactly at the Output section's true top edge, not a clamped
  approximation.

## 12. UI scale-down (2026-08-21, adjusted 90% → 95% same day)

- [x] First attempt (`font-size: 90%` on `html, body, #root`, as literally requested)
  was empirically verified to have **zero visible effect** — every font-size and
  spacing value in the redesign is a hardcoded `px` (copied verbatim from the design
  handoff), so there's nothing `rem`/`em`-relative for a root font-size change to
  cascade into. Flagged this to the user rather than ship a no-op; switched to
  `zoom: 90%` on the same rule instead, which scales layout, text, and spacing together
  at the rendering level regardless of what units the CSS uses — confirmed via
  `document.body.scrollHeight` dropping from 1567px to exactly 1410px (1567 × 0.9) and a
  visual screenshot pass across hero/source/voice/roast-card/footer for alignment.