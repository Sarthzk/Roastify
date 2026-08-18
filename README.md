# Roastify

> Drop a profile. Get destroyed. Survive with tips.

**[→ roastify-two.vercel.app](https://roastify-two.vercel.app/)**

---

Roastify is an AI-powered profile roaster. Paste a GitHub, LinkedIn, or Instagram URL — or upload your resume — and it'll tear it apart like Ricky Gervais at the Golden Globes. You get a savage roast and 5–7 actionable tips to actually improve.

Choose your pain level: **Mild**, **Medium**, or **Destroy Me**. Choose your model too: **GPT-4o**, or Cohere's **Command A** / **Command R** via OpenRouter.

---

## What it supports

- **GitHub** — roasts your repos, contribution graph, and bio using the GitHub API
- **LinkedIn** — goes after your buzzwords and professional facade
- **Instagram** — critiques your aesthetic and engagement
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
| `OPENAI_API_KEY` | the GPT-4o model option | https://platform.openai.com/api-keys |
| `OPENROUTER_API_KEY` | the Command A / Command R model options | https://openrouter.ai/keys |
| `APIFY_API_TOKEN` | LinkedIn / Instagram scraping | https://console.apify.com/account/integrations |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiting + scrape caching | a Redis database at https://console.upstash.com/ |

GitHub and resume roasts work without the Apify token or Upstash credentials —
Apify is only needed for LinkedIn/Instagram, and the app fails open (skips rate
limiting/caching) if Upstash isn't configured. You only need one of `OPENAI_API_KEY`
/ `OPENROUTER_API_KEY` — just whichever model(s) you plan to select in the UI.

### Checks

```sh
npm run lint    # eslint (frontend + index.js — see CLAUDE.md for what it doesn't cover)
npm test        # vitest, pure parsing functions in api/roast.js
npm run build   # production build
```

---

Built with React, Vite, GPT-4o / Cohere Command (via OpenRouter), and deployed on Vercel.