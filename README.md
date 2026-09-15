# Roastify

> Drop a profile. Get destroyed. Survive with tips.

**[→ roastify-two.vercel.app](https://roastify-two.vercel.app/)**

---

Roastify is an AI-powered profile roaster. Paste a GitHub or Instagram URL — or upload your resume or a LinkedIn profile PDF — and it'll tear it apart. You get a savage roast and 5–7 actionable tips to actually improve.

Choose your pain level: **Mild**, **Medium**, or **Destroy Me**. Choose your judge too — three personas, same input, very different roasts:

- **The Cynic** — dry, nihilistic, Ricky-Gervais-at-the-Golden-Globes flavored. The original voice.
- **The Recruiter** — savage but professional. No jokes, no nihilism — a blunt hiring verdict citing exactly what's wrong, with the most concrete fix-it tips of the three.
- **The Desi Uncle** — disappointed, not cruel, comparing you to an imaginary more-successful relative. Heaviest Hinglish, funny rather than mean underneath.

Runs on Groq's free tier, fast enough that the roast streams in live as it's written.

---

## What it supports

- **GitHub** — roasts your repos, contribution graph, and bio using the GitHub API
- **LinkedIn** — export your profile as a PDF (More → Save to PDF) and upload it, or
  paste the text — goes after your buzzwords and professional facade. Not a live URL
  scrape: LinkedIn blocks unauthenticated profile reads, so this is the only reliable way
  in
- **Instagram** — critiques your aesthetic and engagement. Scrapes public profiles only
  (a private or nonexistent account fails with a clear, honest error, never a silent
  guess); the scrape result is cached for 24h and isn't persisted anywhere beyond that.
  Kept as a live scrape rather than moved to upload like LinkedIn — Instagram's Apify
  actor actually works, unlike LinkedIn's — but if that ever changes,
  `INSTAGRAM_ENABLED=false` turns it off server-side and hides the source in the UI,
  no deploy required (see `.env.example`). **Requires signing in** — Apify runs are
  billed, and Instagram is the app's only paid scraping dependency, so it's gated behind
  an account rather than open to anyone
- **Resume** — drag in a PDF or paste text and watch it burn

---

## Sign in and roast history

Sign-in (GitHub or Google, via Supabase Auth) is optional — the app works fully without
it. Anonymous visitors can roast GitHub, LinkedIn, and resume profiles, capped at **3
roasts/day** (keyed by IP), and nothing is added to a history. Signing in bumps that to
**15 roasts/day** (keyed by account, so it follows you across devices/networks), unlocks
Instagram, and every roast you generate is saved to **`/history`**. Every roast is
persisted either way, signed in or not — an anonymous one just isn't attributed to
anyone or listed anywhere.

Roastify has four routes: `/` (the roaster), `/history` (your own past roasts, signed
in only — a signed-out visit gets an explanation and a sign-in prompt, never a redirect
or a dead link — each roast has its own delete control), `/r/:slug` (a single shared
roast — route and page shell exist, but there's no way to actually generate a shareable
link yet; that's a separate, later feature), and `/privacy` (what's collected, where it
goes, and how to delete a roast or your whole account).

Sign-in is entirely optional infrastructure: with `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` unset, the whole app runs
anonymous-only (same as before Supabase was added) — no crash, no degraded experience
beyond not having an account tier to opt into.

### Chat (backend only)

A signed-in user can continue a conversation in the same persona voice that produced one
of their roasts — the persona is locked at creation and can't be changed mid-conversation.
This is backend-only for now (no UI yet — see `CLAUDE.md`'s "Chat" section), so it's
built to be fully exercised by curl. The model only ever sees the roast text/tips it
already generated, never the original scraped profile or resume — Roastify doesn't store
that, so a chat reply can't reference details the roast itself didn't mention.

```sh
TOKEN="<a real Supabase access_token — see below>"
ROAST_ID="<a roast id belonging to that same user>"

# 1. Start a conversation from an existing roast.
CONVERSATION_ID=$(curl -s -X POST http://localhost:3001/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"roastId\": \"$ROAST_ID\"}" | jq -r .id)
echo "$CONVERSATION_ID"

# 2. Send a message — streams the reply over SSE.
curl -N -X POST http://localhost:3001/api/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"conversationId\": \"$CONVERSATION_ID\", \"content\": \"What was the worst part?\"}"

# 3. Fetch the conversation with its messages so far.
curl -s http://localhost:3001/api/conversations?id=$CONVERSATION_ID \
  -H "Authorization: Bearer $TOKEN" | jq .

# 4. Delete it (cascades to its messages).
curl -s -X DELETE http://localhost:3001/api/conversations?id=$CONVERSATION_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

`$TOKEN` needs to be a real Supabase `access_token` for a signed-in user — the quickest
way to get one locally is to sign in through the running frontend (`npm run dev`), then
read `session.access_token` from the browser's devtools console
(`(await supabase.auth.getSession()).data.session.access_token` — `supabase` is the
client exported from `src/lib/supabaseClient.js`, reachable if you log it from
`Layout.jsx` once). `$ROAST_ID` is any `id` from that same user's `roasts` rows (e.g. via
`GET /api/history` with the same token, or straight from the Supabase table editor).

Every request without a valid token gets `SIGN_IN_REQUIRED` (401); a `roastId`/
`conversationId` that doesn't exist or belongs to someone else gets `ROAST_NOT_FOUND` /
`CONVERSATION_NOT_FOUND` (404), deliberately identical either way, same as `/api/history`.
Chat messages get their own rate-limit bucket — 60/day, separate from and higher than the
15/day roast limit, since a chat turn is much cheaper (no scrape).

**Setting up your own Supabase project:**
1. Create a project at https://supabase.com, then apply the schema in
   `supabase/migrations/` — either `supabase db push` (with the [Supabase
   CLI](https://supabase.com/docs/guides/cli) linked to your project) or by pasting the
   migration file's contents into the SQL editor in the dashboard.
2. Enable the GitHub and Google providers under Authentication → Providers, each with
   its own OAuth app/client. Register `http://localhost:5173` and your production
   domain as redirect URLs for both.
3. **Google's consent screen starts in "Testing" mode**, which restricts sign-in to
   accounts you've explicitly added as test users in the Google Cloud console — this is
   normal for development, not a bug. It needs to be moved to "Production" (submitted
   for verification, if it requests scopes that require it) before real users outside
   your test list can sign in with Google.
4. Copy the project's URL/anon key/service role key from Settings → API into `.env`.

---

## Running it locally

The frontend and the API are two separate processes locally — Vite's dev server proxies
`/api/*` requests to a small local API server.

```sh
npm install
cp .env.example .env   # fill in your keys, see below

node index.js           # terminal 1 — API server on http://localhost:3001
npm run dev              # terminal 2 — frontend on http://localhost:5173
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required for | Where to get it |
| --- | --- | --- |
| `GROQ_API_KEY` | every roast — the pinned production model (GPT-OSS 120B) | https://console.groq.com/keys (free tier, no credit card) |
| `APIFY_API_TOKEN` | Instagram scraping only | https://console.apify.com/account/integrations |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiting + scrape caching | a Redis database at https://console.upstash.com/ |
| `INSTAGRAM_ENABLED` | optional — set to `false` to turn Instagram off server-side and hide it in the UI, no deploy required | n/a — your own kill switch |
| `NODE_ENV` | optional — set to `development` to unlock the dev-only GPT-4o comparison option and skip the Upstash rate-limit check locally | n/a |
| `OPENAI_API_KEY` | optional, dev-only — the GPT-4o comparison option (`NODE_ENV=development`) | https://platform.openai.com/api-keys |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | optional — sign-in + roast history (see "Sign in and roast history" above) | your Supabase project's Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | optional, server-only — required alongside the two above for sign-in to work | same place, "service_role" key |
| `SENTRY_DSN` | optional, server-only — error tracking (see "Error tracking" below) | your Sentry project's Settings → Client Keys (DSN) |

GitHub, LinkedIn, and resume roasts all work without the Apify token or Upstash
credentials — Apify is only needed for Instagram now (LinkedIn moved to PDF
upload/paste, no scraping involved), and the app fails open (skips rate
limiting/caching) if Upstash isn't configured. There's no model picker in production —
every roast uses Groq's GPT-OSS 120B regardless of what a client sends. `OPENAI_API_KEY`
is only needed if you set `NODE_ENV=development` locally and want to try the GPT-4o
comparison option in the (dev-only) model picker. The three Supabase variables are all
optional together — leave all three unset and the app runs fully anonymous-only, same as
before sign-in existed.

### Checks

```sh
npm run lint    # eslint (frontend + index.js — see CLAUDE.md for what it doesn't cover)
npm test        # vitest, api/**/*.test.js
npm run build   # production build
```

---

## Error tracking

Server-side errors (`api/`) can optionally report to [Sentry](https://sentry.io) —
`api/_lib/sentry.js`. To turn it on:

1. Create a project at https://sentry.io — pick the **Node.js** platform (not Next.js or
   the Vercel integration; this repo wires the SDK directly).
2. Copy its DSN from the project's Settings → Client Keys, and set `SENTRY_DSN` in
   `.env` (locally) or your deploy platform's environment variables (production).
3. That's it — no code change needed. The very next deploy/restart starts reporting.

With `SENTRY_DSN` unset (the default — no project has been created yet), Sentry is
entirely off: no crash, no warning, no behavior change. Every failure path still logs to
the console exactly as it always has; Sentry is additional, not a replacement. Only error
codes, types, model names, and stack traces are ever sent — never scraped profile
content, resume text, roast text, or email addresses (see the no-PII comment in
`api/_lib/sentry.js` and everywhere it's called).

Not every failure is a Sentry issue: expected user input/behavior (a typo'd username, a
private profile, a missed rate limit, a missing sign-in) stays in the structured console
log only — sending those would bury real failures under noise. `api/_lib/errors.js`
declares this per error code (`ERROR_CODE_META`'s `reportToSentry`), and
`reportError()` (`api/_lib/sentry.js`, what every call site actually calls — `captureError()`
is the underlying always-report primitive it wraps) reads it off the thrown `RoastError`
before deciding to report; a `RoastError` constructed with a code that hasn't declared one
throws immediately, so a new failure mode can't slip through unclassified. Non-`RoastError`
errors (an actual bug, an Apify/Redis/Upstash failure, a JWT verification failure) always
report — see `shouldReportToSentry()`. Every reported error is also tagged with an
`environment` (`development` when `NODE_ENV=development`, `production` otherwise) so local
runs don't pollute production issues in the dashboard.

---

Built with React, Vite, Groq (GPT-OSS 120B), and deployed on Vercel.