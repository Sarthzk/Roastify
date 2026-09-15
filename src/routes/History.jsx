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

      {signedIn && !loading && !error && roasts.length === 0 && (
        <section className="row">
          <div className="row-label">
            Saved <span className="history-list-label">0</span>
          </div>
          <div className="history-empty-body">
            <p className="history-empty-copy">Nothing here yet. Roast a profile and it'll show up the moment it's done.</p>
            <Link to="/" className="history-empty-provider">
              roast something
            </Link>
          </div>
        </section>
      )}

      {signedIn && !loading && !error && roasts.length > 0 && (
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
                <span className="hist-row-cell">{personaLabel(r.persona)}</span>
                <span className="hist-row-cell">{r.severity}</span>
                <span className="hist-row-cell hist-row-date">{formatDate(r.created_at)}</span>
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
    </div>
  );
}
