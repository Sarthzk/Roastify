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

- [x] **Add fallback roasts for every profile type.** Only `resume` has
  `defaultResumeResponse()` for when the OpenAI/scrape call fails. Add equivalent
  fallback roast + tips for `github`, `linkedin`, and `instagram` so a failure never
  just shows a bare error.

- [x] **Cap input length before sending to OpenAI.** Scraped bios/about text and
  pasted resume text currently go into the prompt unbounded. Truncate (e.g.
  `.slice(0, 4000)`) before building `userMessageContent`, both to control token cost
  and reduce prompt-injection surface from untrusted profile text.

- [x] **Tighten LinkedIn/Instagram scrape timing.** The Apify poll loop can take up to
  ~45s (15 attempts × 3s) before the OpenAI call even starts, against a 60s
  `maxDuration`. Either reduce the poll budget, or add a clear "still working" state
  in the UI so a timeout doesn't look like a silent failure.

## 2. Quick UX wins

- [x] **Add Open Graph / Twitter Card meta tags** to `index.html` (`og:title`,
  `og:description`, `og:image`, `twitter:card`). Right now a shared Roastify link has
  no preview — a real miss for a tool whose whole point is sharing the result.
  (Note: `og:image` still points at `/og-image.png`, which doesn't exist yet.)

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
- [x] Restrict CORS on `api/roast.js` to the production domain only.
- [x] Add `npm audit` (or enable Dependabot) and fix any flagged vulnerabilities.
  (5/6 fixed non-breaking; the last one, a `pdfjs-dist` breaking major-version bump,
  is left for explicit approval — see the note under Section 4/README.)
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
  doesn't re-trigger a full Apify run.

### Testing & CI
- [x] Add Vitest unit tests for the pure parsing functions in `api/roast.js`:
  `extractGithubUsername`, `extractInstagramUsername`, `getField`, and the
  LinkedIn/Instagram field-extraction logic — these have the most edge cases and
  the least test coverage risk tolerance.
- [x] Add a GitHub Actions workflow that runs `npm run lint`, tests, and
  `npm run build` on every PR.

### Legal / compliance
- [ ] Decide explicitly on LinkedIn/Instagram scraping risk: keep as-is, add a
  visible disclaimer, or drop those profile types for the production version.
  Document the decision (e.g. in the README) rather than leaving it implicit.
- [ ] Add a short privacy note on the site covering what's sent to OpenAI/Apify
  and confirming no profile data is persisted server-side beyond ephemeral
  rate-limit counters.

### Documentation
- [x] Expand the README with real setup steps and the `.env.example` reference.

## 4. LLM migration: GPT-4o → open model via OpenRouter

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

## 5. Feature ideas (pick what's interesting — later)

- [ ] Roast history saved to `localStorage` so past roasts aren't lost on refresh.
- [ ] Persona picker beyond "Ricky Gervais" (the Hinglish tips already hint at a
  specific audience/tone — lean into it with 2-3 selectable personas).
- [x] Stream the roast token-by-token (SSE) instead of waiting for the full JSON blob.
- [ ] "Redemption mode" — after checking off tips, let the user re-submit and see if
  the roast softens.
- [ ] X/Twitter profile support alongside GitHub/LinkedIn/Instagram/resume.