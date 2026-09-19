# Roastify — Improvement Tasks

Context: React + Vite app, Vercel serverless functions calling Groq (`gpt-oss-120b`,
production-pinned; GPT-4o survives only as a dev-only comparison option), Apify for
Instagram scraping only (LinkedIn is PDF upload, not scraped), GitHub REST API for
GitHub, Upstash Redis for rate limiting, Supabase for auth + Postgres persistence. Live
at https://roastify-two.vercel.app/

Open items are listed first, so this file stays readable in under a minute. Resolved
work is kept below for reference, one `<details>` block per historical section —
expand a section only if you need the detail behind a decision. Run `npm run lint`,
`npm test`, and `npm run build` after any change.

---

## Open

### Needs the user (infrastructure/account settings, not code — matches GYM_TASKS.md's
"Blocked" section)
- Bot protection (Cloudflare Turnstile or hCaptcha) in front of `/api/roast` — needs
  Cloudflare keys not yet created.
- Hard spend caps / billing alerts set directly on the Groq, Apify, and OpenAI accounts —
  defense in depth beyond the app's own rate limiting; a dashboard setting, not code.
- Uptime monitoring (UptimeRobot / Better Uptime) on the production URL — never set up.
- A regular habit of actually checking the Groq/Apify/OpenAI spend dashboards — they
  exist, but watching them is a person's job, not something to automate here.

### Feature ideas (no urgency — pick what's interesting)
- "Redemption mode" — after checking off tips, let the user re-submit and see if the
  roast softens.
- X/Twitter profile support alongside GitHub/LinkedIn/Instagram/resume.
- ~~Roast history saved to `localStorage`~~ — superseded: real signed-in, Postgres-backed
  history already exists (Section 14/15), so this no longer needs doing.

### Small open item
- [x] ~~**Privacy still shows a dark v4 chrome body under the light header/footer.**~~ Done 2026-09-19 — Privacy rebuilt to the light Neu-Brutalist system (see WORK_LOG.md v8).
- [x] ~~**History's search/persona/source filters are client-side only.**~~ Done 2026-09-19 — real server-side filters in `api/history.js`.
- [x] **Vercel Hobby 12-function cap** — deploy failed because colocated `api/**/*.test.js` counted as functions (14 files). `.vercelignore` now excludes them (7 real functions). Done 2026-09-19; confirm on the next deploy.
- [x] **Mobile header** (<=600px) collapses to logo + quota + hamburger, nav/account in a slide-down panel. Done 2026-09-19 (real-device touch not verified).
- **Chat's "Audit Diagnostics"-equivalent metrics were dropped outright, not
  hardcoded.** The Chat redesign (2026-09-18) flagged and left out several mockup stats
  with no backend field (ego integrity/ego defended, per-message severity/ego-deduction
  scores, evidence citations, tech-stack audit, burns-incurred/tokens-consumed). Home's
  own equivalent mockup stats (Audit Diagnostics tiles, Key Indictments) went through a
  hardcode-then-remove cycle earlier the same day and are gone now too, so both pages
  currently land in the same place — no fabricated stats anywhere on either page. Just a
  note for context, not something needing a decision.
- **Chat's "re-run profile audit" and "export verdict dossier" buttons are unbuilt.**
  The mockup showed both in the Telemetry & Quota panel; neither has a description in
  the task or an existing mechanism to call (re-running a roast from inside a
  conversation, exporting a chat transcript/image). Needs a product decision before
  either gets built.
- **Chat's per-conversation draft auto-save (localStorage) is new, unrequested surface
  area.** Added during the Chat redesign so the mockup's "DRAFT AUTO-SAVED" label would
  be honest rather than fabricated — small and client-only, but worth knowing it's there
  since nothing asked for it directly.
- **Real (non-dev-bypassed) chat rate-limit-reached state is unverified.** `NODE_ENV=
  development` bypasses the chat tier's Upstash check the same way it does the roast
  flow's, so the rebuttals-remaining meter and the 429 error path were only exercised
  against the dev bypass, never a real 60/day limit actually being hit.
- **Live prompt-injection verification** (Section 6, 2026-08-19). The fencing mechanism
  (`fenceUntrustedContent()`, `UNTRUSTED_DATA_NOTICE`) is built and has real unit test
  coverage, but nobody has actually run a live model call against a real scraped bio
  containing an injection attempt to confirm the model genuinely ignores it rather than
  just trusting the prompt instruction in the abstract. Still owed.
- **Chat migrations still need applying**. Both
  (`supabase/migrations/20260916000000_conversations_and_messages.sql` and
  `supabase/migrations/20260917000000_roasts_profile_data.sql`) still need to actually be
  applied to any real Supabase project running this app — same manual step the
  2026-09-12 roasts/reports migration needed (see Section 14). The purge cron
  (`api/cron/purge-expired-profile-data.js`, `vercel.json`'s `crons` entry) needs
  `CRON_SECRET` set in production to be properly secured — works without it, but accepts
  any caller until it's set (see `.env.example`).

---

## Resolved / archived

Everything below is historical record, newest work at the bottom. Collapsed by
section — expand only if you need the reasoning behind something.

<details>
<summary><strong>1. Critical fixes</strong> (2026-08-19) — debug data leak removed, fallback roasts deleted (reversed later, see Section 6), input length capped, LinkedIn/Instagram scrape timing tightened</summary>

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

</details>

<details>
<summary><strong>2. Quick UX wins</strong> (2026-08-19) — OG/Twitter meta tags, a real checkbox, native share, rate limit surfaced in the UI</summary>

- [x] **Add Open Graph / Twitter Card meta tags** to `index.html` (`og:title`,
  `og:description`, `og:image`, `twitter:card`). Right now a shared Roastify link has
  no preview — a real miss for a tool whose whole point is sharing the result.
  (**Update 2026-08-19**: `og:image`/`twitter:image` removed — see Section 8. They
  pointed at a `/og-image.png` that never existed; no image-generation capability was
  available to produce a real branded one, so the broken reference was removed rather
  than left dangling. **Update 2026-09-15**: re-added for real — a generated
  1200×630 PNG now exists at `public/og-image.png` via the committed
  `scripts/generate-og-image.mjs`; `twitter:card` restored to `summary_large_image`.
  See WORK_LOG.md.)

- [x] **Replace the fake checkbox in `RoastCard.jsx`.** The tip list uses a
  `<label onClick>` + styled `<span>` instead of a real `<input type="checkbox">` —
  fine visually but bad for keyboard/screen-reader users. Swap to a real checkbox
  styled to match.

- [x] **Use `navigator.share()`** in `handleShare` (RoastCard.jsx) when available,
  falling back to the current clipboard-copy behavior. Much better on mobile.

- [x] **Surface the rate limit to the user.** Show remaining roasts (or a cooldown
  timer) against the 5-per-hour Upstash limit instead of only reacting to a 429 after
  the fact.

</details>

<details>
<summary><strong>3. Production readiness</strong> — security/abuse prevention, observability, reliability, testing/CI, legal/compliance, docs</summary>

### Security & abuse prevention
- [ ] Add bot protection (Cloudflare Turnstile or hCaptcha) in front of roast
  submission — without it, anyone can script-hammer `/api/roast` and run up the
  OpenAI + Apify bill regardless of the Upstash rate limit. **Still open — see "Open"
  at the top of this file.**
- [ ] Set hard spend caps / billing alerts on the OpenAI and Apify accounts directly
  (defense in depth beyond app-level rate limiting). **Still open.**
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
- [x] Add error tracking (Sentry) in place of bare `console.error` calls, so failures
  surface somewhere you'll actually see them. **Done 2026-09-15** — `api/_lib/sentry.js`,
  wired alongside every existing `console.error` under `api/` (never replacing it), off
  entirely until `SENTRY_DSN` is set (no project created yet). See WORK_LOG.md and the
  README's "Error tracking" section.
- [ ] Add uptime monitoring on the production URL (UptimeRobot / Better Uptime).
  **Still open.**
- [ ] Set up a simple way to track OpenAI + Apify spend over time (both provide
  usage dashboards — just make sure someone's actually watching them). **Still open.**

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
- [x] **Instagram — decided, resolved 2026-08-23: keep scraping as-is.** Unlike
  LinkedIn, Instagram's Apify actor actually works, so dropping it isn't forced the way
  LinkedIn's was — and there's no PDF/upload equivalent to swap to anyway (a screenshot
  upload would need a vision-capable model, a materially bigger change than LinkedIn's
  PDF swap). Reasoning documented in README's "What it supports": public profiles only
  (a private/nonexistent account fails honestly, never a silent guess), scraped data
  cached 24h and not persisted beyond that, and `INSTAGRAM_ENABLED` (see Section 10) as
  the fast, no-deploy removal path if the calculus ever changes.
- [x] Add a short privacy note on the site covering what's sent to Groq/Apify and
  confirming no profile data is persisted server-side beyond ephemeral rate-limit
  counters and the 24h Instagram/GitHub scrape cache. **Done 2026-09-15** — real `/privacy`
  route, linked from the footer, with working per-roast delete (on each `/history` row)
  and account delete (on the privacy page itself) backing the page's delete claims — see
  WORK_LOG.md.

### Documentation
- [x] Expand the README with real setup steps and the `.env.example` reference.

</details>

<details>
<summary><strong>4. LLM migration: GPT-4o → open model via OpenRouter</strong> — superseded, historical only; OpenRouter/Cohere no longer exist in this codebase (see 4B)</summary>

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

</details>

<details>
<summary><strong>4B. Provider swap: OpenRouter/Cohere → Groq</strong> (2026-08-19) — production pinned to one free model (gpt-oss-120b), model picker becomes dev-only</summary>

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

</details>

<details>
<summary><strong>5. Feature ideas</strong> — persona picker and SSE streaming shipped; localStorage history superseded; redemption mode and X/Twitter still open (see "Open" at top)</summary>

- [ ] ~~Roast history saved to `localStorage` so past roasts aren't lost on refresh.~~
  Superseded — see "Open" at the top of this file.
- [x] Persona picker beyond "Ricky Gervais" — see Section 7. Shipped 3 selectable
  personas (cynic/recruiter/desi-uncle), not 2, with the prompt layer restructured to
  support them.
- [x] Stream the roast token-by-token (SSE) instead of waiting for the full JSON blob.
- [ ] "Redemption mode" — after checking off tips, let the user re-submit and see if
  the roast softens. **Still open — see "Open" at the top of this file.**
- [ ] X/Twitter profile support alongside GitHub/LinkedIn/Instagram/resume. **Still
  open.**

</details>

<details>
<summary><strong>6. Honest error handling + prompt injection defense</strong> (2026-08-19) — canned fallbacks replaced with real error codes; fencing built; live injection test still owed (see "Open" at top)</summary>

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
  prompt-only JSON enforcement (Section 4B) actually fails. **Update 2026-09-15**: also
  reports to Sentry (`api/_lib/sentry.js`) alongside the console log, tagged with
  `code`/`type`/`model`/`persona` only — never `bufferPreview`. See Section 3's
  Observability item and WORK_LOG.md.
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
- [ ] Manual verification (live model call) still pending — see "Open" at the top of
  this file.

</details>

<details>
<summary><strong>7. Persona system + prompt layer restructure</strong> (2026-08-19) — 3 personas shipped (cynic/recruiter/desi-uncle), prompt fragments composed instead of duplicated</summary>

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

</details>

<details>
<summary><strong>8. Cleanup pass: split api/roast.js, dead weight, design tokens</strong> (2026-08-19) — no behavior changes aside from the CORS/cache-TTL/og-image items</summary>

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
- [x] **`og:image`**: removed, rather than fabricated, at the time — see Section 2's
  update for the 2026-09-15 follow-up that generated a real one.

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
- Not upgraded — left for explicit approval, per instruction. **Still true as of
  2026-09-15** — `npm audit` still flags this (2 moderate + this 1 high), noticed again
  in passing during Task 4/5 of this session's work but out of scope to fix without
  explicit approval, same as before.

</details>

<details>
<summary><strong>9. Replace LinkedIn scraping with LinkedIn PDF upload</strong> (2026-08-21) — net deletion; LinkedIn actor never worked, replaced with the same PDF flow resume already used</summary>

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

</details>

<details>
<summary><strong>10. Visual redesign (Claude Design v2 handoff) + Instagram kill switch</strong> (2026-08-21) — same product/API, new presentation; mobile breakpoints later verified for real (see Section 15 note below and 2026-09-15's Task 1)</summary>

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
- [x] Tests: no frontend test suite exists at the time (vitest only covered
  `api/**/*.test.js` until 2026-09-15's Task 7 — see Section 3/Testing), so this pass
  touched zero existing tests — confirmed 87/87 backend tests still pass unmodified
  (aside from the kill-switch item below).
- [x] **Manually verified live** in a real browser (desktop, real Groq/Apify/Upstash
  credentials): idle, a real error (invalid GitHub handle → synthesized detail line
  matching spec), a real streaming roast (watched the derived-from-lifecycle stage label
  and live char count update against actual Groq tokens), complete (meta row, working fix
  checklist), and "roast another" reset. **Mobile breakpoints not manually verified at
  the time** — the available browser-resize tooling didn't actually shrink the rendering
  viewport in that session. **Resolved 2026-09-15**: a full real-narrow-viewport audit
  (380/600/900px, via a same-origin iframe with a genuinely different
  `window.innerWidth`, not the broken resize tool) found and fixed several real mobile
  bugs across the whole app — see WORK_LOG.md's Task 1 entry.

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

</details>

<details>
<summary><strong>11. Auto-scroll to Output, actually fixed</strong> (2026-08-21) — root cause was window.scrollTo clamping to the page's height at call time, not while streamed content was still growing it</summary>

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
- [x] **Follow-up same day**: user wanted the first scroll to fire immediately on click
  rather than waiting for the first streamed chunk. Moved trigger (1) from "first
  content" back to synchronous-at-submit-time — same clamped-and-short-but-instant
  tradeoff the original (broken) version had, but now paired with the terminal-state
  correction from the fix above, so the early jump is still followed by a corrective
  scroll once the response is fully in. Net: `hasScrolledToOutputRef` guard removed
  (no longer needed — each trigger now fires at a point that naturally happens at most
  once per request), `scrollToOutput()` extracted once and called from both
  `handleSubmit` and the terminal-state effect instead of being duplicated.

</details>

<details>
<summary><strong>12. UI scale-down</strong> (2026-08-21) — font-size scaling was a no-op given the design's hardcoded px values; switched to zoom instead</summary>

- [x] First attempt (`font-size: 90%` on `html, body, #root`, as literally requested)
  was empirically verified to have **zero visible effect** — every font-size and
  spacing value in the redesign is a hardcoded `px` (copied verbatim from the design
  handoff), so there's nothing `rem`/`em`-relative for a root font-size change to
  cascade into. Flagged this to the user rather than ship a no-op; switched to
  `zoom: 90%` on the same rule instead, which scales layout, text, and spacing together
  at the rendering level regardless of what units the CSS uses — confirmed via
  `document.body.scrollHeight` dropping from 1567px to exactly 1410px (1567 × 0.9) and a
  visual screenshot pass across hero/source/voice/roast-card/footer for alignment.

</details>

<details>
<summary><strong>13. Cleanup pass: dead dependencies, zoom/breakpoint audit, doc accuracy</strong> (2026-08-23) — removed framer-motion and Tailwind; found the zoom-compounding bug (see "Open" at top); fixed stale docs</summary>

Goal: no new features — remove unused dependencies, check a real correctness question
about the shipped `zoom: 97%` rule against the responsive breakpoints, and fix stale
documentation. Net deletion.

### Dead dependencies removed
- [x] **`framer-motion`**: zero references anywhere in `src/` (confirmed by grep before
  removing) — never used. Removed from `package.json` via `npm uninstall`.
- [x] **Tailwind** (`tailwindcss`, `@tailwindcss/vite`): the whole app used exactly three
  utility-class usages total (`w-full flex flex-col` on `InputForm`'s root wrapper,
  `hidden` on the file input, `absolute inset-0 w-4 h-4 cursor-pointer opacity-0` on the
  visually-hidden fix-checkbox) — everything else is the hand-written CSS class system
  from the v2 redesign. Replaced each with an equivalent plain CSS class in
  `src/index.css` (`.input-form`, `.hidden`, `.fix-row-checkbox-input`), then removed the
  `@import "tailwindcss"` line, the `@tailwindcss/vite` plugin from `vite.config.js`, and
  both packages from `package.json`.
- [x] **Bundle size, before → after** (`npm run build`): CSS 26.06 kB → 17.92 kB raw
  (−31.2%), 5.76 kB → 3.75 kB gzip (−34.9%) — Tailwind's base/reset/utility generation is
  gone. JS 1,028.71 kB → 1,028.67 kB raw (effectively flat — `framer-motion` was never
  actually bundled since nothing imported it, and Tailwind is a build-time CSS tool with
  no JS runtime footprint).
- [x] **Verified the UI renders identically** — the one item here with real regression
  risk. Live in a real browser: full page screenshot compared against the pre-removal
  render (pixel-identical layout/spacing); confirmed the hidden file input's
  `getComputedStyle().display` is still `"none"`; confirmed the fix-tip checkbox's
  hidden-input styling matches the old Tailwind values exactly (`position: absolute`,
  `opacity: 0`, `cursor: pointer`, `16px` square) and that clicking it still toggles
  `.is-checked` and updates the fixes counter correctly.
- [x] 95/95 tests passing (frontend has no test suite, so dependency/CSS changes
  couldn't touch it either way). `npm run lint` and `npm run build` both clean.

### Zoom vs. breakpoints — a real bug found, not just an offset
- [x] Checked the premise directly rather than assuming: is `window.innerWidth` (what
  `@media` queries evaluate against) affected by the `zoom: 97%` rule on
  `html, body, #root`? **No** — confirmed empirically by toggling zoom off/on at a fixed
  window size and reading `window.innerWidth`/`matchMedia()` both times: identical in
  both cases. Media queries fire at the real, physical viewport width; zoom only
  rescales what's rendered inside it. This matches the premise in the task description.
- [x] **But a bigger, unrelated bug turned up while checking this**: `zoom: 97%` on the
  selector `html, body, #root` doesn't apply 97% zoom once — it applies the *same*
  declaration to three separate, nested ancestor elements (`html` contains `body`
  contains `#root`), and CSS `zoom` compounds through nested application the way
  `transform: scale()` would. Measured directly: `.hero`'s internal layout width
  (`offsetWidth`, what content lays out against) vs. its rendered/visual width
  (`getBoundingClientRect().width`, what's actually on screen) differ by a factor of
  **0.9127, not 0.97** — which is `0.97³` to four significant figures. Confirmed the
  compounding is real (not a measurement artifact) by forcing zoom to 1 on `body` and
  `#root` while leaving it at 0.97 on `html` alone: the ratio came back to exactly
  0.9703, matching a single un-compounded 97%. **The page is actually rendering at
  ≈91.3% scale, not the intended 97%.** Not fixed — out of scope (the task says don't
  touch the zoom rule) — but this needs a decision along with the breakpoint question
  below, since it changes the correction math. **Still an open decision — see the top of
  this file.** (Section 15 later consolidated the 3-ancestor rule onto `#root` alone, but
  at the same already-compounded 0.9127 value — a code cleanup, not a resolution of the
  underlying question.)
- [x] **Breakpoint correction, given the above**: because content lays out against
  `real_viewport_width / effective_zoom` (not the real viewport directly), the same
  nominal breakpoint value now trips later — at a smaller real viewport — than the
  design intended, since the compressed content doesn't visually feel cramped until
  well past where the breakpoint fires. Corrected value = `original × effective_zoom`.
  Using the actual current effective zoom (0.9127, i.e. the compounded value):
  | Breakpoint | Original | Corrected (current 91.3% effective zoom) | Corrected (if compounding is separately fixed to a true flat 97%) |
  | --- | --- | --- | --- |
  | Desktop → laptop | 1180px | ~1077px | ~1145px |
  | Laptop → tablet | 900px | ~821px | ~873px |
  | Tablet → phone | 600px | ~548px | ~582px |
  | Small phone | 380px | ~347px | ~369px |
  Not changed — reported only, per instruction. The two right-hand columns diverge by
  40–50px each, which is why the compounding bug needs a decision before the breakpoint
  values themselves are worth touching. **Note (2026-09-15)**: a full mobile audit at the
  *current* nominal breakpoint values (380/600/900px, Section 15/Task 1) found and fixed
  several real layout bugs, but did not revisit whether the breakpoint numbers themselves
  should change — that's still gated on the decision above.

### Documentation accuracy
- [x] `ROASTIFY_TASKS.md`'s own header fixed: "calling GPT-4o, Apify for
  LinkedIn/Instagram scraping" → Groq (`gpt-oss-120b`, production-pinned) + Apify for
  Instagram only.
- [x] Swept README.md and CLAUDE.md for the same class of staleness. README was already
  fully accurate (Groq/GPT-4o-dev-only/LinkedIn-is-upload all correctly stated already,
  likely from prior sessions' doc passes). CLAUDE.md had one real miss: the "Deployment"
  section said the 60s `maxDuration` budget has to fit "the OpenAI call" — a holdover
  from before the Groq migration; production never calls OpenAI. Fixed to "the LLM call
  (Groq in production...)".
- [x] Also fixed, while in the neighborhood: `ROASTIFY_TASKS.md`'s "Add a short privacy
  note" item said "what's sent to OpenAI/Apify" — same staleness, same fix (→ Groq/Apify).
- [x] **Resolved the open Instagram legal/compliance item**: decision is to keep
  Instagram scraping as-is (unlike LinkedIn, its Apify actor actually works, and there's
  no PDF/upload equivalent to swap to — a screenshot-based alternative would need a
  vision-capable model, a materially bigger change). Reasoning documented in README's
  "What it supports" list: public profiles only (private/nonexistent accounts fail with
  a real error, never a silent guess), scraped data cached 24h and not persisted beyond
  that, and `INSTAGRAM_ENABLED` (Section 10) as the fast, no-deploy removal path if the
  calculus changes. Task item marked resolved.

</details>

<details>
<summary><strong>14. Supabase auth + Postgres persistence</strong> (2026-09-12) — anonymous use kept working with no login wall; migration since confirmed applied (see Section 16 and 2026-09-15's work)</summary>

Goal: the foundation for chat and public share pages later — schema and persistence,
not those features themselves. Anonymous use must keep working with no login wall.

- [x] `@supabase/supabase-js` added. `src/lib/supabaseClient.js` (browser, anon key) and
  `api/_lib/supabaseAdmin.js` (server, service role key) both degrade to
  unconfigured/`null` when the relevant env vars are absent — the app boots and runs
  fully anonymous-only rather than crashing, verified by building with none of the three
  Supabase vars set.
- [x] `api/_lib/auth.js`'s `getAuthenticatedUser(req)` verifies the `Authorization:
  Bearer` JWT against Supabase Auth (`admin.auth.getUser(token)`) and derives `{ id,
  email }` — the server never trusts a client-sent user id. Real (not mocked-Supabase)
  test coverage in `api/_lib/auth.test.js`: valid token, invalid/expired token, absent
  header, non-Bearer header, unconfigured Supabase, and a rejected Auth API call — all
  via a mocked `supabaseAdmin.js`, no live calls.
- [x] `supabase/migrations/20260912000000_roasts_and_reports.sql` — real SQL, not an
  ORM. `roasts` (`user_id` nullable — anonymous roasts are stored for analytics, just
  unattributed; `visibility`/`slug` added now, nullable and unused, so the future
  share-page feature is additive) and `reports` (schema only, for later moderation). RLS
  enabled on both from the start; `roasts` gets real read/delete-own policies, no
  INSERT policy on either table for anon/authenticated since every write is
  server-side via the service role key. No new profiles/scrape-cache table — the
  existing Redis scrape cache already covers that.
- [x] Rate limiting re-keyed for tiers (`api/_lib/rateLimit.js`): `createRatelimit(tier)`
  + `getRateLimitKey(user, ip)`, `RATE_LIMIT_TIERS` (`anonymous: 3/day`,
  `authenticated: 15/day`) replacing the old flat 5/hour. Keyed by user id when signed
  in, IP when not. Dev bypass and fail-open behavior both preserved unchanged.
  `api/rate-limit-status.js` now also verifies the caller's JWT and reports
  `signedIn`/`tier` so the frontend shows the right limit before the user ever submits.
- [x] Instagram gated behind sign-in, server-side (`SIGN_IN_REQUIRED`, 401) — independent
  of the existing `INSTAGRAM_ENABLED` kill switch (both are checked, either alone
  rejects the request). `api/rate-limit-status.js`'s `signedIn` field lets the UI tell
  the two "Instagram unavailable" reasons apart, per the task's requirement.
  `InputForm.jsx` keeps the Instagram card visible-but-locked for anonymous users
  (dashed "sign in" tag, disabled, tooltip) rather than hiding it.
- [x] Completed roasts persisted via `api/_lib/persistRoast.js` (service role key,
  fail-open on any write error) right before the `complete` SSE event — `roast`/`tips`
  only, never the raw scraped/pasted profile text (no PII, matching the existing
  `logFailure()` policy).
- [x] Frontend: `App.jsx` owns `session` state (`useState` + `onAuthStateChange`, no
  state library), header renders sign-in (GitHub/Google)/sign-out controls matching the
  existing monospace-caps/hard-rule/zero-radius design language, or falls back to the
  original static "no login" tag when Supabase isn't configured. `getRoast`/
  `getRateLimitStatus` attach the session's JWT as a Bearer header when present.
- [x] Verification: 115/115 tests pass (95 previous + 20 new — `api/_lib/auth.test.js`,
  `api/_lib/rateLimit.test.js`, plus new describe blocks in `api/roast.test.js` and
  `api/rate-limit-status.test.js` for the sign-in gate and tier-based keying), `npm run
  lint`/`npm test`/`npm run build` all clean. Confirmed `SUPABASE_SERVICE_ROLE_KEY` is
  absent from the built client bundle by grepping `dist/` for both the env var name and
  a fake secret value injected only at build time. Manually clicked through the running
  app (both local dev servers): anonymous UI (locked Instagram card, "sign in ·
  github"/"sign in · google" header buttons, correct copy), a full anonymous GitHub
  roast end-to-end, an anonymous Instagram request correctly rejected with
  `SIGN_IN_REQUIRED`, and the GitHub OAuth button correctly redirecting to GitHub's real
  authorize screen with the right `client_id`/`redirect_uri` — did not complete the
  actual OAuth login (needs the user's real GitHub/Google credentials). The one thing
  this surfaced: the `roasts` table doesn't exist on the connected Supabase project yet
  (the migration hasn't been applied there) — `persistRoast` failed open exactly as
  designed (the roast still completed for the user), logging "Could not find the table
  'public.roasts' in the schema cache." **Applying the migration was flagged as a
  follow-up step for the user at the time — since confirmed done**: Section 16
  (2026-09-15) already shows real signed-in roasts being listed against the user's own
  real account (one row, 3+ rows, a 26-row long list), and 2026-09-15's later
  per-roast/account delete work (Section 3's privacy-note item) built directly on the
  `"roasts: delete own"` RLS policy from this same migration already being live.

</details>

<details>
<summary><strong>15. v3 redesign: routing, header auth, tier-aware source states, history page</strong> (2026-09-13) — routing added, /history built (GET only), share-page slug/visibility explicitly out of scope</summary>

Goal: implement the v3 Claude Design handoff — routing, header auth UI wired to the
session state already built in Section 14, tier/locked source states driven by real
`/api/rate-limit-status` data, and the `/history` page (signed-in list + signed-out
locked panel). Not this task: `/r/:slug` slug generation, visibility, or the actual
sharing flow — route and shell only.

- [x] Read the authoritative bundle via DesignSync — three handoff generations were
  present (`design_handoff_roastify_redesign/` v1, `_v2/`, `_v3/`); v3's own README
  declared v2 superseded ("do not implement from it"), so `design_handoff_roastify_v2/
  README.md` was deleted from the bundle to prevent a future session reading it by
  mistake. v1 had no README to begin with.
- [x] `react-router-dom` added. Three routes under one shared `<Layout>` (header +
  footer): `/` (`Roaster.jsx`), `/history` (`History.jsx`), `/r/:slug`
  (`SharedRoast.jsx`, shell only). `vercel.json` got a catch-all SPA rewrite. Session
  state moved from `App.jsx` into `Layout.jsx`; roaster-specific state moved into
  `Roaster.jsx` and stayed local to it (resets on navigation for free, matching the
  handoff's "roaster form state does not persist" rule) rather than being lifted higher.
- [x] Header: real nav (active-state from the route) and real auth (sign-in dropdown
  panel with GitHub/Google, closes on selection/outside-click/Escape/sign-in; signed-in
  avatar + handle + sign out). Old static "no login / free" tags removed, replaced by
  the sign-in UI — or the original "no login" tag only when Supabase isn't configured.
  **Update 2026-09-15**: the dropdown gained a real focus trap and focus restoration on
  close (Escape/close button) — neither existed before; see WORK_LOG.md's Task 6 entry.
- [x] Source cells (github/linkedin/resume/instagram) are never hidden now — a real
  behavior change from Section 14's implementation, which hid Instagram outright when
  the kill switch was off. Per-cell state (`open`/`locked`/`disabled`) computed from
  real `instagramEnabled`/`signedIn` data; kill switch outranks the sign-in lock.
  Clicking a non-open cell opens an inline prompt (invitation marker + direct
  GitHub/Google buttons for "locked"; a plain note for "disabled") instead of selecting
  it. Two copy strings from the handoff were rewritten before shipping since they made
  claims not true of this app's real architecture (see WORK_LOG.md for the exact
  before/after) — everything else implemented verbatim.
- [x] Severity split into its own gutter row (previously shared "Voice" with persona);
  lost its sublabels per the `.dc.html`'s own v3 template (raw value text only). Persona
  moved to a 3-across grid sharing the source grid's cell shape. Index numbers, the hero
  side panel, the "how it works" strip, the streaming char counter + spacer, and the
  rate-limit tick meter are all removed, matching the handoff's own diff list.
- [x] New `SIGN_IN_REQUIRED` "invitation" Output state in `RoastCard.jsx` — visually
  distinct from `Error` (outlined marker vs. filled `!` square, no `ERROR` label),
  matching the handoff's explicit "a tier boundary must never read as a failure" rule.
  Only reachable if a session expires mid-flow; the locked source cell already prevents
  submitting Instagram while signed out.
- [x] `GET /api/history` — the only API surface touched, per instruction. Rejects a
  missing/invalid JWT with `SIGN_IN_REQUIRED` (401). Otherwise queries through a new
  per-request Supabase client scoped to the caller's own JWT (`api/_lib/supabaseUser.js`,
  anon key + `Authorization` header) rather than the service-role admin client, so
  Postgres RLS — not application code — is what actually restricts results to the
  caller's own rows. Paginated 25 at a time via `?cursor=` (an ISO `created_at`
  timestamp). `History.jsx` renders three states beyond signed-out-locked: loading,
  real error, empty (`Saved 0`, distinct copy), and populated with a `load more` row.
  **Update 2026-09-15**: `DELETE /api/history?id=` added (per-roast delete, owner-only
  via the same RLS-scoped client) — see Section 3's privacy-note item and WORK_LOG.md.
- [x] Consolidated the `html, body, #root { zoom: 97% }` compounding-zoom rule (see
  Section 13's finding — actual effective scale ≈91.27%, not 97%) onto `#root` alone at
  the honest already-compounded value, since this session's CSS rewrite touched that
  rule anyway. Visual result unchanged; the three-nested-ancestor form is gone. (The
  underlying "should this actually be 97%" question is still open — see the top of this
  file.)
- [x] Verification: 120/120 tests (5 new in `api/history.test.js`), lint/build clean,
  confirmed `SUPABASE_SERVICE_ROLE_KEY` still absent from the built bundle. Manually
  clicked through every route, both auth states, the locked/disabled source prompts, the
  header sign-in panel, a full anonymous GitHub roast end-to-end, and the ≤600px mobile
  breakpoint (via an injected same-origin iframe — `resize_window` didn't actually
  resize the viewport in this environment). No console errors.

</details>

<details>
<summary><strong>16. /history: row contrast + short-list gap fix</strong> (2026-09-15) — presentation only; mobile-only severity-chip rule later re-verified live (see note below)</summary>

Goal: apply an updated design handoff for `/history` — the same v3 handoff files, edited
in place with two reworked areas (row type hierarchy, and a dedicated fix for the
short-list dead-gap issue). Presentation only; no other route, the history endpoint, or
auth touched.

- [x] Confirmed both issues against the handoff before changing anything, per
  instruction: the previous implementation matched the *old* handoff exactly (byte-level
  comparison of colors against the prior `.dc.html`), so these were genuine design
  reworks, not implementation bugs.
- [x] Row type hierarchy inverted: handle/filename is now primary (17px, `--ink`,
  ellipsis on overflow) instead of the source kind; persona/severity/date moved to two
  new mid-brightness tokens (`--ink-row-2` `#9a9992`, `--ink-row-3` `#7c7e81`) added to
  `src/index.css`, extending the token system rather than hardcoding. `--ink-2`/`--ink-3`
  are now documented gutter-label-only per the handoff, never row content. Severity
  became a bordered chip (`justify-self: start`). **Update 2026-09-15 (same day, later
  session)**: both row-content tokens (and the rest of the `--ink*` scale) were lifted
  further for readability — see WORK_LOG.md's Task 0 entry for the before/after values
  and contrast ratios.
- [x] Short-list gap fixed with the handoff's own mechanism: a closing `NEXT`/`EMPTY`
  panel below the list, `flex: 1` + `min-height: 260px`, inside a flex-column route root
  (`.history-page`). Closes the gap for one, two, or three roasts; a long list just lets
  the panel sit at its floor height since there's no leftover space. Count-aware title/
  body/CTA. Confirmed this only applies to the signed-in Next/Empty row — the signed-out
  locked panel has no such row and keeps its pre-existing gap, matching the handoff
  exactly (it doesn't extend the fix to signed-out either; flagged to the user rather
  than assumed).
- [x] Two copy strings adapted before shipping (same principle as an earlier session):
  the handoff's Next/Empty body mentions delete and re-run/open, neither of which exists
  yet. Kept the accurate first sentence in each case, dropped the rest. **Update
  2026-09-15**: per-roast delete is real now (Section 3's privacy-note item) — the
  "delete any roast from your history" claim on `/privacy` is backed by an actual control
  on each row here.
- [x] Row clicks confirmed (not implemented, per instruction): the handoff routes an
  entire row to `/r/:slug` on click; still nothing to route to until the sharing task
  ships real slugs.
- [x] Verification: 120/120 tests (no test changes needed), lint/build clean. Checked
  live against the user's own real account: one row, 3+ rows, a 26-row long list, the
  empty state (via a temporary `window.fetch` intercept for `/api/history`, not synthetic
  component state), and signed-out (via the real sign-out button — flagged to the user
  that this logged their actual session out). Mobile checked for header/hero/locked-panel
  via an injected iframe; the signed-in row's mobile-only rule (severity chip drops its
  border at ≤600px) was added per spec but not re-verified live, to avoid a second
  sign-out/sign-in cycle on the real account. **Resolved 2026-09-15 (same day, later
  session)**: Task 1's full mobile audit re-verified `/history` at this exact breakpoint
  and found a related real bug in the same area (persona/severity/date collapsing onto
  one line instead of stacking) — fixed; see WORK_LOG.md.

### Also this session: adopted the Git workflow from CLAUDE.md for the first time
The working tree had ~32 files of uncommitted work (Sections 14 and 15, both already
verified in their own sessions) sitting on `main` with no `dev` branch yet. Per the new
Git workflow section, stopped and asked rather than committing it as part of this task;
user chose to stash it, create `dev` from clean `main`, then pop the stash onto `dev` (the
only way `/history` could exist to work on). Committed the stashed work as two commits
matching the existing WORK_LOG entries (auth/persistence, then routing/redesign) before
starting this task's own new work, and pushed `dev` to origin.

</details>

<details>
<summary><strong>17. GYM_TASKS.md unsupervised session</strong> (2026-09-15) — contrast lift, mobile audit, privacy page + delete controls, Sentry, og:image, accessibility pass, test coverage; see WORK_LOG.md for full detail</summary>

A batch of 8 numbered tasks run unsupervised in one session while the user was away —
full narrative for each lives in `WORK_LOG.md`'s 2026-09-15 entries, not duplicated here.
One-line summary per task, in the order they ran:

- **Task 0 — ink token contrast lift**: raised all six `--ink*` tokens for readability,
  reported before/after hex + WCAG ratios, kept the muted identity and relative ordering.
- **Task 1 — mobile compatibility audit**: genuine narrow-viewport testing (an iframe
  with a real `window.innerWidth`, since `resize_window` still doesn't actually resize
  the viewport here). Found and fixed: touch targets silently shrunk below 44px by the
  root zoom, five sub-11px text tokens, history rows not stacking per-field at ≤600px,
  and the sign-in dropdown rendering side-by-side with its trigger at ≤600px.
- **Task 2 — `/privacy` page + real delete controls**: per-roast delete (`DELETE
  /api/history?id=`) and account delete (`DELETE /api/account`, cascades via the
  existing `on delete cascade` FK) built *before* the privacy page shipped, since the
  page's own copy promised both.
- **Task 4 — Sentry scaffolding**: `api/_lib/sentry.js`, off entirely until `SENTRY_DSN`
  is set (still unset — no project created), wired alongside every existing
  `console.error` under `api/`.
- **Task 5 — og:image**: a real generated 1200×630 PNG (`scripts/generate-og-image.mjs`,
  committed and regenerable), replacing the removed-but-never-replaced reference from
  Section 8/2.
- **Task 6 — accessibility pass**: full contrast audit (numbers reported, `--ink-4`
  found dead and removed, one hardcoded hex tokenized), a real focus-visibility bug
  fixed (the fixes-checklist checkbox's `opacity: 0` was hiding its own focus outline),
  and a focus trap + focus restoration added to the sign-in dropdown.
- **Task 7 — test coverage**: vitest widened to cover `src/**/*.test.js` too (previously
  API-only). `describeError`/`sourceState`/upload-handling logic extracted to `src/lib/`
  (component files can only export components, or Vite Fast Refresh breaks) and tested;
  extended the history-pagination and rate-limit-tier-isolation backend suites.
- Tasks 3 (delete controls) and 8 (this documentation sweep) are covered under Tasks 2
  and this section respectively — see `GYM_TASKS.md` itself for the exact task list and
  the end-of-session four-point report.

</details>

<details>
<summary><strong>18. Chat backend: conversations + messages, backend only</strong> (2026-09-16) — new tables, RLS, two endpoints, a chat-specific system prompt, its own rate-limit tier; no UI (see "Small open item" at top)</summary>

A signed-in user can now continue a conversation in the same persona voice that produced
one of their roasts, entirely by curl (no frontend built in this task — see README's "Chat
(backend only)" section for the walkthrough and CLAUDE.md's "Chat" section for the full
design).

- **Schema**: `supabase/migrations/20260916000000_conversations_and_messages.sql` —
  `conversations` (`roast_id` nullable, `on delete cascade` — deleting the roast a
  conversation is anchored to takes the conversation with it; `user_id` not null, unlike
  `roasts.user_id`, since there's no anonymous chat) and `messages` (no `user_id` column;
  RLS joins back to `conversations.user_id`). `roast_id` being nullable is deliberate
  headroom for a future debate-mode feature that reuses these tables with no roast
  attached — nothing for that was built. Same RLS shape `roasts` already established:
  read/delete-own policies, no INSERT policy (service role only).
- **Persona locking**: copied from the roast onto the conversation at creation, read back
  from the conversation row on every message turn — never from the request body, so
  there's nothing for a client-supplied persona to attach to. Tested directly
  (`api/messages.test.js` sends one and asserts it's ignored).
- **Endpoints**: `api/conversations.js` (`POST` start / `GET ?id=` fetch-with-messages /
  `DELETE ?id=`) and `api/messages.js` (`POST`, streams the reply over SSE). Ownership
  enforced via a client scoped to the caller's own JWT, same as `api/history.js` — a
  wrong/foreign id and a genuinely missing one are indistinguishable 404s
  (`ROAST_NOT_FOUND` at conversation-start, a new `CONVERSATION_NOT_FOUND` everywhere
  else). All four operations signed-in only.
- **System prompt**: a new composer (`api/_lib/prompts/chat.js`), not an extra branch on
  `getSystemPrompt()` — reuses the persona fragment and `UNTRUSTED_DATA_NOTICE`, adds a
  new `CHAT_BASE_FRAGMENT` that explicitly tells the model it does NOT have the scraped
  profile/resume (Roastify never stored that, only the roast output), so it can't
  hallucinate profile details the roast never mentioned — keeps the privacy page's claim
  honest in a multi-turn chat too. The roast text/tips get the same `fenceUntrustedContent()`
  treatment scraped profile data already gets, since the roast is model output derived
  from attacker-controlled input.
- **Context window**: `CHAT_CONTEXT_MESSAGE_LIMIT` (20, exported from `api/messages.js`)
  caps prior history sent to the model on top of the new message. Summarizing older
  history instead of just dropping it past the cap is explicitly deferred, not built.
- **Model call**: no JSON-contract/`response_format` toggling — chat is plain
  conversational text, so real streaming works unconditionally on Groq (unlike
  `api/roast.js`'s `{ roast, tips }` contract, which has to drop `response_format` for the
  same reason). `api/_lib/modelClient.js` extracted the Groq/OpenAI client-building logic
  out of `api/roast.js` so both endpoints share it instead of duplicating — pure
  mechanical move, `api/roast.test.js`'s existing `openai` mock still covers it unchanged.
- **Persistence**: `api/_lib/persistChatTurn.js`, fail-open like `persistRoast.js` and for
  the same reason (the client already has the streamed reply by the time this runs) — but
  reports every failure via `reportError()` rather than risking the same silent-failure
  history `PERSIST_ROAST_FAILURE` was created to fix.
- **Rate limiting**: its own `chat` tier (60/day, keyed by user id) — separate from and
  higher than the 15/day authenticated roast tier, since a chat turn has no scrape and is
  much cheaper. Same dev bypass as `api/roast.js`.
- **Error reporting**: the new `CONVERSATION_NOT_FOUND` code was added to
  `ERROR_CODE_META` (`api/_lib/errors.js`) as `reportToSentry: false` — a bad/foreign
  conversation id is the caller's business, not a system failure, same classification as
  `ROAST_NOT_FOUND`. No other new codes needed.
- **Tests**: 32 new (`api/conversations.test.js`, `api/messages.test.js`,
  `api/_lib/prompts/chat.test.js`, plus small additions to `api/_lib/rateLimit.test.js`) —
  persona locking, ownership enforcement on every endpoint, the context-window cap
  (mocked history longer than the limit, asserting only the last N reach the model, oldest
  of those first), anonymous rejection, and a roast/conversation belonging to another user
  being refused. All mocked (Supabase, OpenAI) — no live calls. 188 tests total, lint and
  build clean.

</details>

<details>
<summary><strong>19. Chat gets access to scraped profile data (github/instagram only)</strong> (2026-09-17) — roasts table extended, 30-day retention with a real purge cron, two chat base-fragment variants, privacy page updated</summary>

Chat previously only ever saw the roast text — this closes the gap so it can answer
"what about my other repos?" with a real answer instead of an invented one, for the two
source types where storing the scraped profile is actually fine. Full design writeup in
`CLAUDE.md`'s "Chat" section ("Profile data for chat"); this entry is a compressed
summary.

- **Deliberate asymmetry**: GitHub/Instagram profiles are public and low-PII, so storing
  them is fine. LinkedIn/resume come from an uploaded document (name, employer,
  sometimes phone/address) and the privacy page promises uploaded files are never
  stored — that stays true; chat for those two keeps working from the roast text alone,
  exactly as it did before this task. Commented at every enforcement point so it isn't
  "fixed" later.
- **Schema**: extended `roasts` rather than a join table (`supabase/migrations/20260917000000_roasts_profile_data.sql`)
  — `profile_data`/`profile_data_expires_at`, plus CHECK constraints enforcing the
  type restriction and the null/non-null pairing at the schema level too. Verified, not
  assumed, that the existing `roasts.user_id on delete cascade` already covers the new
  columns — no schema change needed for account deletion to still work.
- **Storage enforcement**: `persistRoast.js`'s `STORABLE_PROFILE_DATA_TYPES` set is the
  real gate, independent of what `api/roast.js` passes — a future caller mistake can't
  quietly start storing linkedin/resume text. `MAX_INPUT_LENGTH` (the existing scraped-
  content cap) was exported from `api/roast.js` and reused rather than a second
  hardcoded `4000`.
- **Retention, for real**: `api/messages.js` falls back to roast-only context (never an
  error) once `profile_data_expires_at` has passed, independent of cron timing. Actual
  deletion — so it doesn't just sit there, ignored — is a new scheduled endpoint,
  `api/cron/purge-expired-profile-data.js`, on Vercel's daily Cron Jobs (`vercel.json`),
  secured by an optional `CRON_SECRET`.
- **Chat prompt**: two base fragments now (`CHAT_BASE_FRAGMENT_WITH_PROFILE` /
  `_NO_PROFILE`), chosen by whether usable profile data exists for this turn;
  `getChatSystemPrompt()` fences profile data the same way it already fenced the roast.
- **Privacy page**: a new paragraph under "What we keep" documents this — stored,
  30-day expiry, deleted immediately with the roast or account. The "uploaded files are
  never stored" promise is untouched.
- **Tests**: 27 new/rewritten (`api/_lib/persistRoast.test.js`,
  `api/cron/purge-expired-profile-data.test.js`, new describe blocks in
  `api/_lib/prompts/chat.test.js` and `api/messages.test.js`) — storage gating in both
  directions, expiry fallback without erroring, fencing, and base-fragment selection. 215
  tests total, lint and build clean. Both migrations written, neither applied — left for
  the user to run.

</details>

<details>
<summary><strong>20. Chat UI</strong> (2026-09-18) — /chat and /chat/:id routes, both entry points wired, mobile fixed shell, new list endpoint</summary>

Wired the chat backend (Sections 18-19) to a real interface, from a Claude Design
handoff. Full design writeup in `CLAUDE.md`'s "Chat" section's "Frontend" subsection;
this entry is a compressed summary — see `WORK_LOG.md`'s 2026-09-18 entry for the why
and the verification detail.

- **New list endpoint**: `api/conversations.js` gained `handleList()` (paginated 25 at a
  time, RLS-backed, dispatched off `GET` with no `?id=`) — there was no way to list a
  caller's conversations before this. `handleGet()` (the `?id=` path) also now returns
  the linked roast's full content, not just the conversation row.
- **Routes**: `src/routes/ChatList.jsx` (`/chat`) and `src/routes/ChatThread.jsx`
  (`/chat/:id`), a third `CHAT` nav item in `Layout.jsx` alongside `ROAST`/`HISTORY`, a
  signed-out locked state on both (`src/components/ChatLockedPanel.jsx`, shared).
- **Two entry points, both landing on `/chat/:id` directly**: a "keep talking to
  `<persona>`" CTA on a completed roast (`RoastCard.jsx` + `Roaster.jsx`'s
  `handleStartChat()`), and `History.jsx` rows, made clickable for the first time.
  Neither backend action returns a roast id directly, so the roast-completion entry
  point leans on a documented invariant (the newest row in the caller's own history)
  rather than a new backend field.
- **Streaming reused, not reimplemented**: `src/lib/openai.js`'s `consumeRoastStream`
  was generalized into `consumeSseStream(res, chunkEventName, onChunk)`; `sendChatMessage`
  uses the same function with `"message"` instead of a second SSE parser.
- **Mobile fixed shell**: `/chat/:id` becomes a fixed-height, footer-dropped shell at the
  existing 600px breakpoint, done entirely via the `:has()` selector off a single marker
  class on the route's own root element — no changes to the shared `Layout.jsx`. Verified
  at a real 376px width via a same-origin iframe + direct `getComputedStyle()`
  inspection, not just a screenshot (`resize_window` doesn't actually resize the
  rendered viewport in this environment).
- **A real bug found via live testing**: a null-crash on fresh page load caused by a
  `useState` initializer capturing a not-yet-resolved `signedIn` value — not reachable
  from the automated test suite (`node` environment, no real async session timing).
  Fixed at the root cause plus a defensive guard; see `WORK_LOG.md` for the full story.
- **Tests**: 225 total (up from 215) — new `src/lib/chatHelpers.test.js` (pure logic:
  `formatDate`, `lastMessagePreview`) plus new list-mode coverage in
  `api/conversations.test.js`. Lint and build clean. Extended `src/index.css`'s existing
  token system for every new color — no new hardcoded hex.
</details>

<details>
<summary><strong>21. Stitch redesign: Home, Chat, History, Privacy</strong> (2026-09-16) — dark neo-brutalist visual system from Stitch MCP; presentation only, zoom hack removed, resolves the Section 13 zoom/breakpoint question by deleting the zoom entirely</summary>

Full writeup in `WORK_LOG.md`'s 2026-09-16 (v4) entry — this is a compressed summary.

- **Source**: Stitch project "Roastify Frontend Redesign" (`projects/7127362638254684669`),
  4 screens mapped 1:1 to `/`, `/chat`+`/chat/:id`, `/history`, `/privacy`. One screen's
  cached thumbnail was stale (showed the wrong page) — caught by reading the actual HTML
  export instead of trusting the screenshot.
- **Resolves the "needs a decision" zoom item above**: the old `#root { zoom }` hack (and
  `--root-zoom`, which compensated `--touch-44`/`--touch-48` and every `100dvh` for it) is
  removed outright, not adjusted — this design's spacing was sized directly against the
  real viewport, so the 91.3%-vs-97% question no longer applies to anything.
- **A lot of the mockup was fabricated** (per-card ATS/damage/jargon scores, hero vanity
  stats, a fictional Instagram "upload screenshots for OCR" input path, Privacy's entire
  "Data Actions & Live Telemetry" section, and several outright-wrong retention claims) —
  none of it is backed by a real endpoint, so none of it was built. See WORK_LOG.md for
  the full list of what was left out and why.
- **Structural, not just color**: Home gained a real 2-column desktop split
  (`.studio-grid`); History/Chat rows get Stitch-style `.01`/`.02`… numbering via a CSS
  counter (no markup change); persona cards gained a decorative flavor tag
  (`src/lib/personas.js`'s new `tag` field); severity pills gained per-tier coloring via a
  value-derived class in `InputForm.jsx`; Privacy's account-delete flow became a "type to
  unlock" pattern (still calls the same `deleteAccount()`).
- **Verification**: `npm run lint`/`npm test` (225/225, no selector changes — none of the
  existing tests touch the DOM)/`npm run build` all clean; all 4 routes loaded live with
  zero console errors; mobile (including the trickiest piece, the chat thread's fixed
  shell) verified for real via the same same-origin-iframe + `getComputedStyle()`
  technique Section 20 established, not just screenshotted. Not verified: exact pixel
  fidelity against the Stitch mockup, and real-device rendering.
</details>
