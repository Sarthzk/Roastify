import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getHistory } from "../lib/openai";
import { PERSONAS } from "../lib/personas";

function personaLabel(id) {
  return PERSONAS.find((p) => p.value === id)?.name ?? id;
}

function formatDate(iso) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short" }).toLowerCase();
  return `${day} ${month}`;
}

// The closing panel below the list — title/body/CTA are count-aware, and it's the
// list's own terminator (no separate footer CTA needed). Its min-height keeps a short
// list from looking too sparse; the footer sitting flush after it (rather than pinned
// to the viewport bottom) is the shared layout's job, not this panel's — see
// src/index.css's "Layout shell". The "kept until you delete it" / "re-run any saved
// roast" lines from the handoff are dropped — neither delete nor re-run exists yet
// (that's the sharing task), and the first sentence in each case is the part that's
// actually true today.
function nextPanelCopy(count) {
  if (count === 0) {
    return {
      label: "Empty",
      title: "Nothing here yet.",
      body: "Your first roast lands here the moment it finishes — source, voice, severity, and the fixes you ticked off.",
      cta: "run your first roast",
    };
  }
  return {
    label: "Next",
    title: count === 1 ? "One roast on the record." : `That is ${count} roasts on the record.`,
    body: "Run another and it goes straight to the top of this list.",
    cta: "run another roast",
  };
}

// Signed-in only — a signed-out visitor gets a locked panel here (never a redirect, so a
// shared /history link isn't a dead end), not a route guard. Rows link nowhere yet:
// /r/:slug has no real slugs behind it until the sharing task ships, so this only lists
// what's saved.
export default function History() {
  const { session, signIn } = useOutletContext();
  const signedIn = Boolean(session);

  const [roasts, setRoasts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(signedIn);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Resets loading/error the moment there's a new token to fetch with (sign-in, or a
  // session refresh) — adjusted during render (React's own pattern for "reset state when
  // a prop changes") rather than in the effect below, which would cost an extra render
  // pass for a synchronous setState call right before the async fetch it kicks off.
  const [prevToken, setPrevToken] = useState(session?.access_token);
  if (session?.access_token !== prevToken) {
    setPrevToken(session?.access_token);
    if (signedIn) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!signedIn) return;
    getHistory(session.access_token)
      .then((data) => {
        setRoasts(data.roasts);
        setCursor(data.nextCursor);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [signedIn, session?.access_token]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getHistory(session.access_token, cursor);
      setRoasts((prev) => [...prev, ...data.roasts]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const next = nextPanelCopy(roasts.length);

  return (
    <div>
      <section className="hero">
        <div className="hero-main">
          <h1 className="hero-title hero-title--small">History</h1>
          <div className="hero-rule hero-rule--small" />
          <p className="hero-copy">
            {signedIn ? "Every roast you have run, newest first." : "Roasts are kept for signed-in accounts only."}
          </p>
        </div>
      </section>

      {!signedIn && (
        <section className="row">
          <div className="row-label row-label--accent">Locked</div>
          <div className="history-empty-body">
            <div className="invitation-top">
              <span className="invitation-icon">&#8226;</span>
              <span className="invitation-msg">History starts the moment you sign in.</span>
            </div>
            <p className="history-empty-copy">
              Every roast you run while signed in is kept here — source, voice, severity, and
              when you ran it. Nothing before that is recoverable, so sign in first and start
              the record.
            </p>
            <div className="history-empty-actions">
              <button type="button" className="history-empty-provider" onClick={() => signIn("github")}>
                continue with github
              </button>
              <button
                type="button"
                className="history-empty-provider history-empty-provider--secondary"
                onClick={() => signIn("google")}
              >
                google
              </button>
            </div>
          </div>
        </section>
      )}

      {signedIn && loading && (
        <section className="row">
          <div className="row-label">Saved</div>
          <div className="idle-body">
            <span className="idle-label">loading…</span>
          </div>
        </section>
      )}

      {signedIn && !loading && error && (
        <section className="row">
          <div className="row-label row-label--accent">Error</div>
          <div className="error-body">
            <div className="error-top">
              <span className="error-icon">!</span>
              <span className="error-msg">Couldn't load your history.</span>
            </div>
            <span className="error-detail">{error}</span>
          </div>
        </section>
      )}

      {signedIn && !loading && !error && (
        <>
          {roasts.length > 0 && (
            <section className="row">
              <div className="row-label">
                Saved <span className="history-list-label">{roasts.length}</span>
              </div>
              <div>
                {roasts.map((r) => (
                  <div key={r.id} className="hist-row">
                    <span className="hist-row-source">
                      <span className="hist-row-kind">{r.type}</span>
                      <span className="hist-row-handle">{r.identifier ?? "—"}</span>
                    </span>
                    <span className="hist-row-persona">{personaLabel(r.persona).toLowerCase()}</span>
                    <span className="hist-row-severity">{r.severity}</span>
                    <span className="hist-row-date">{formatDate(r.created_at)}</span>
                  </div>
                ))}
                {cursor && (
                  <button type="button" className="hist-load-more" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "loading…" : "load more"}
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="row history-next-row">
            <div className="row-label">{next.label}</div>
            <div className="history-next-panel">
              <div className="history-next-copy">
                <div className="history-next-title">{next.title}</div>
                <p className="history-next-body">{next.body}</p>
              </div>
              <Link to="/" className="history-next-cta">
                {next.cta}
                <span>&#8594;</span>
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
