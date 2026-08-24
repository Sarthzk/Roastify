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
  no deploy required (see `.env.example`)
- **Resume** — drag in a PDF or paste text and watch it burn

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
| `OPENAI_API_KEY` | optional, dev-only — the GPT-4o comparison option (`NODE_ENV=development`) | https://platform.openai.com/api-keys |

GitHub, LinkedIn, and resume roasts all work without the Apify token or Upstash
credentials — Apify is only needed for Instagram now (LinkedIn moved to PDF
upload/paste, no scraping involved), and the app fails open (skips rate
limiting/caching) if Upstash isn't configured. There's no model picker in production —
every roast uses Groq's GPT-OSS 120B regardless of what a client sends. `OPENAI_API_KEY`
is only needed if you set `NODE_ENV=development` locally and want to try the GPT-4o
comparison option in the (dev-only) model picker.

### Checks

```sh
npm run lint    # eslint (frontend + index.js — see CLAUDE.md for what it doesn't cover)
npm test        # vitest, api/**/*.test.js
npm run build   # production build
```

---

Built with React, Vite, Groq (GPT-OSS 120B), and deployed on Vercel.