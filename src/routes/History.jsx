import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getHistory, deleteRoast, startConversation } from "../lib/openai";
import { personaName } from "../lib/personas";
import { formatDate } from "../lib/chatHelpers";

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
  const navigate = useNavigate();
  const signedIn = Boolean(session);

  const [roasts, setRoasts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(signedIn);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  // Which row (by id) is showing its "delete this?" confirm state, and which one is
  // mid-request — separate from `error` above, which is the load failure, not a delete one.
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  // Which row is mid-"open chat" request — a row's own informational area is a button
  // (see the render below), so this doubles as that button's disabled/pending state.
  const [openingId, setOpeningId] = useState(null);
  const [openError, setOpenError] = useState(null);

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

  // Owner-only by construction, not just by convention: `roasts` only ever holds rows this
  // signed-in caller's own token was allowed to fetch (RLS — see api/history.js), and the
  // server re-checks ownership on delete the same way, so there's nothing extra to enforce
  // here beyond removing the row from local state once the server confirms it's gone.
  async function handleConfirmDelete(id) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteRoast(session.access_token, id);
      setRoasts((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  // A history row is the second of the two entry points into chat (the other is the
  // "start chat" CTA on a just-finished roast — see RoastCard.jsx) — both land in
  // /chat/:id, never a blank thread, by starting the conversation first and only
  // navigating once the server hands back its id. Owner-only the same way delete already
  // is: `r.id` only says which roast, ROAST_NOT_FOUND covers both "doesn't exist" and
  // "isn't yours" — see api/conversations.js.
  async function handleOpenChat(roastId) {
    setOpeningId(roastId);
    setOpenError(null);
    try {
      const conversation = await startConversation(session.access_token, roastId);
      navigate(`/chat/${conversation.id}`);
    } catch (err) {
      setOpenError(err.message);
      setOpeningId(null);
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
              {deleteError && <p className="hist-delete-error">Couldn't delete that roast — {deleteError}</p>}
              {openError && <p className="hist-delete-error">Couldn't open that conversation — {openError}</p>}
              <div>
                {roasts.map((r) =>
                  confirmingId === r.id ? (
                    <div key={r.id} className="hist-row hist-row-confirm">
                      <span className="hist-row-confirm-text">Delete this roast? This can't be undone.</span>
                      <span className="hist-row-confirm-actions">
                        <button
                          type="button"
                          className="hist-row-confirm-yes"
                          onClick={() => handleConfirmDelete(r.id)}
                          disabled={deletingId === r.id}
                        >
                          {deletingId === r.id ? "deleting…" : "delete"}
                        </button>
                        <button type="button" className="hist-row-confirm-cancel" onClick={() => setConfirmingId(null)}>
                          cancel
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={r.id} className="hist-row">
                      {/* The row's informational area is the click target that opens chat
                          — a real <button>, not the whole <div>, so the sibling delete
                          button below doesn't end up nested inside it. */}
                      <button
                        type="button"
                        className="hist-row-open"
                        onClick={() => handleOpenChat(r.id)}
                        disabled={openingId === r.id}
                      >
                        <span className="hist-row-source">
                          <span className="hist-row-kind">{r.type}</span>
                          <span className="hist-row-handle">{r.identifier ?? "—"}</span>
                        </span>
                        <span className="hist-row-persona">{(personaName(r.persona) ?? r.persona).toLowerCase()}</span>
                        <span className="hist-row-severity">{r.severity}</span>
                        <span className="hist-row-date">{openingId === r.id ? "opening…" : formatDate(r.created_at)}</span>
                      </button>
                      <button
                        type="button"
                        className="hist-row-delete"
                        onClick={() => setConfirmingId(r.id)}
                      >
                        delete
                      </button>
                    </div>
                  )
                )}
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
