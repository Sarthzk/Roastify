# Roastify — Unsupervised Task Batch

Read `CLAUDE.md` (Code standards and Git workflow), `ROASTIFY_TASKS.md`, and
`WORK_LOG.md` before starting anything.

Work through these in order. All of them are self-contained and need no
decisions from me — if you hit something that genuinely does need a decision,
stop on that task, write down the question, and move to the next one.

Everything goes on `dev`. Commit after each numbered task, not one commit at
the end. Push after each commit. Lint, tests, and build must be clean before
every commit.

---

## 1. Mobile compatibility audit — highest priority

The site has to work properly on a phone, on every route and every state. It
has never been verified end to end. Breakpoints were transcribed from a design
handoff rather than tested, and several states were added after that handoff.

Audit at 380px, 600px, and 900px wide, and check every one of these:

**Roaster (`/`)**
- Header: brand, nav, sign-in control, signed-in avatar + handle + sign out.
  This is the tightest space in the layout and has gained the most.
- Hero, including the display type at the smallest width
- Source row — four cells, plus locked and disabled variants
- The sign-in prompt that appears when a locked source is clicked
- URL input row and the upload/drop zone (both input modes)
- Voice row — three personas with name and tagline
- Severity row
- Submit button and the rate limit strip
- All four output states: idle, streaming, error, complete
- Meta row, fixes checklist, action buttons

**History (`/history`)**
- Signed out (locked panel), signed in empty, short list, long list
- Row layout — five fields per row will not fit at 380px, check what the
  handoff says should happen and whether it was implemented

**Shared**
- Footer
- The `/r/:slug` shell

Fix anything broken. Specific things to check rather than eyeball:
- Nothing overflows horizontally. There must be no sideways scroll anywhere.
- Touch targets meet the sizes in the handoff. Real fingers, not cursors.
- Text remains readable — no sub-11px type.
- The `zoom` rule on the root element interacts with viewport units and media
  queries. Verify results visually rather than trusting the CSS.

Use a real narrow viewport if you can. If the resize tooling in your
environment does not actually shrink the rendering viewport — it has failed
before in this project — say so explicitly rather than reporting a check you
could not really perform.

---

## 2. Privacy note

We store user data now and are about to add public pages. There is no privacy
information anywhere on the site.

Add a `/privacy` route using the existing layout and design language. Link it
from the footer. Use the copy below close to verbatim — adjust only if
something in it is factually wrong about how the app actually works, and tell
me what you changed and why.

> ## Privacy
>
> Roastify is a joke generator with a real backend. Here is exactly what it
> does with your data.
>
> **What you give it**
>
> A profile link, or a PDF you upload. GitHub and Instagram profiles are
> fetched from public sources. LinkedIn profiles and resumes are read from the
> file you upload — the text is extracted in your browser and sent to our
> server to generate the roast.
>
> **Where it goes**
>
> Profile text is sent to Groq, which runs the language model that writes the
> roast. Instagram profiles are fetched through Apify, a third-party scraping
> service. Neither is used to train anything — we do not have that
> arrangement with them, and their own terms apply to what they do with
> requests.
>
> **What we keep**
>
> Scraped profile data is cached briefly to avoid re-fetching the same profile
> — one hour for GitHub, 24 hours for Instagram. After that it is gone.
>
> Roasts are stored: the source, the text, the tips, and which voice and
> severity you picked. If you are signed in, they are attached to your account
> and shown in your history. If you are not, they are stored without any
> identifier.
>
> **Uploaded files are never stored.** The PDF stays in your browser. Only the
> extracted text is sent, and only to generate the roast. Note that the roast
> itself may quote details from your resume, and roasts are stored — so
> anything you upload may end up in the stored roast text.
>
> **Accounts**
>
> Signing in with GitHub or Google gives us your email, display name, and
> avatar. Nothing else. We cannot read your repositories, your email, or
> anything in your Google account. Authentication is handled by Supabase.
>
> **Deleting your data**
>
> You can delete any roast from your history. Deleting your account removes
> every roast attached to it.
>
> **Roasting other people**
>
> Nothing stops you pasting somebody else's profile. Please do not. If
> something about you has ended up here and you want it gone, get in touch.
>
> **Contact**
>
> [Sarthak's contact — fill this in]

Leave the contact line as a placeholder for me to fill in.

**The delete claims must be true before this page ships.** If per-roast delete
and account delete do not exist yet, build them as part of this task:
- A delete control on each history row, owner-only, hard delete
- An account delete that removes the user's roasts and their auth record
- Both enforced server-side against the verified JWT, never a client-sent id

If that turns out to be larger than it looks, say so and leave the privacy
page unlinked until it is done. Do not ship a privacy page that promises
something the app cannot do.

---

## 3. Delete controls (if not already done in task 2)

Covered above. Separate task only if you deferred it.

---

## 4. Sentry scaffolding

Error tracking has been on the backlog since the beginning. Every failure
currently goes to `console.error` or the structured logger and is visible to
nobody in production.

- Wire up Sentry behind a `SENTRY_DSN` env var.
- **The DSN is not set yet** — I have not created the project. The app must
  work completely normally when the var is absent. No crash, no warning spam,
  no degraded behaviour. Absent DSN means Sentry is simply off.
- Replace bare `console.error` calls in the API with Sentry capture, keeping
  the existing structured `logFailure` logging alongside it.
- Never send PII: no scraped profile content, no resume text, no roast text,
  no email addresses. Error codes, types, models, and stack traces only.
- One specific gap to close: `persistRoast` fails open silently. That is the
  right behaviour, but the failure must be reported — it already broke once
  without anybody noticing. Make sure it reports with a distinct code.
- Document the setup steps in the README so I can add the DSN in two minutes.

---

## 5. og:image

`og:image` was removed earlier because it pointed at a file that never
existed. Share pages are next, and link previews will not work without it.

Generate a static 1200x630 PNG matching the site palette — black background,
amber wordmark, the same monospace treatment — and put it in `public/`. Add
back `og:image` and `twitter:image`, and restore `twitter:card` to
`summary_large_image`.

Write the generation as a small committed script rather than a one-off, so it
can be regenerated. If no viable image tooling is available in your
environment, say so and stop on this task rather than committing a broken
reference again.

---

## 6. Accessibility pass

Never been checked. The design is dense, monospace, and low contrast, so this
will find real problems.

- Keyboard navigation through every interactive element on every route.
  Source cells, persona cells, severity, submit, sign-in dropdown, history
  rows, fixes checkboxes.
- Visible focus states, in the design language — not the browser default.
- The sign-in dropdown: focus trap, Escape to close, focus restored on close.
- Screen reader labels on icon-only and glyph-only controls.
- Colour contrast on every text token against its background. Report failures
  with actual ratios rather than fixing silently — some of it is deliberate
  design and I want to see the numbers before it changes.
- `prefers-reduced-motion` is already handled somewhere in the CSS; confirm it
  covers the streaming caret and the progress bar.

Fix what is clearly broken. Report anything where the fix would change the
visual design.

---

## 7. Test coverage gaps

The frontend has no tests at all. Not asking for a full suite, but the
highest-risk pure logic should be covered:

- `describeError` in App.jsx — the error code to message/detail mapping
- The tier and locked-state derivation from the rate limit status response
- PDF text extraction failure handling

Backend gaps worth closing:
- The history endpoint pagination
- Rate limit tier keying — specifically that the anonymous IP bucket and the
  signed-in user bucket are genuinely independent, so signing in does not
  consume the anonymous allowance from the same IP

---

## 8. Documentation sweep

- `ROASTIFY_TASKS.md` has grown to 700+ lines with a lot of resolved items and
  superseded sections. Restructure it: open items at the top, resolved ones
  collapsed or archived to the bottom. It should be readable in under a
  minute.
- Confirm `CLAUDE.md` matches reality after routing, auth, and persistence.
  Anything stale about architecture, request flow, or file layout gets fixed.
- `README` should state plainly what the project is, how to run it, and what
  environment variables are needed. Check that every var in `.env.example` is
  actually used and every used var is listed.

---

## Blocked — do not attempt

These need me and cannot be done unsupervised:

- **Turnstile** — needs Cloudflare keys I have not created
- **Apify spend cap** — dashboard setting, my job
- **Google consent screen publishing** — my Google account
- **Share pages (`/r/:slug`)** — blocked on a product decision about
  default visibility that I have not made yet
- **Merging `dev` to `main`** — I review and merge

---

## When I get back

Tell me, in this order:
1. What you completed and what you skipped, with reasons
2. Anything you found that needs a decision from me
3. The contrast ratio numbers from task 6
4. Whether mobile was verified on a genuinely narrow viewport, or only
   inferred from the CSS
