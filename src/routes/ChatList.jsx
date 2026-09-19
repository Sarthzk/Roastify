import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getConversations, deleteConversation } from "../lib/openai";
import { personaName } from "../lib/personas";
import { formatDate, lastMessagePreview } from "../lib/chatHelpers";
import SignInGate from "../components/SignInGate";

// Signed-in only — a signed-out visitor gets the full-page sign-in gate instead of any
// chat UI (see SignInGate.jsx). Landing on /chat directly shows this list; both
// real entry points into a conversation (a finished roast, a history row) skip straight
// to /chat/:id instead — this list is only reached by typing/sharing the bare /chat URL
// or by an explicit "conversations" link, so it doesn't need its own separate mockup;
// built here in the same visual language as /chat/:id (flagged for review).
export default function ChatList() {
  const { session, signIn } = useOutletContext();
  const signedIn = Boolean(session);

  const [conversations, setConversations] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(signedIn);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  // Same render-time-adjustment pattern as History.jsx: resets loading/error the moment
  // there's a new token to fetch with, rather than costing an extra render pass inside
  // the effect below.
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
    getConversations(session.access_token)
      .then((data) => {
        setConversations(data.conversations);
        setCursor(data.nextCursor);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [signedIn, session?.access_token]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getConversations(session.access_token, cursor);
      setConversations((prev) => [...prev, ...data.conversations]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleConfirmDelete(id) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteConversation(session.access_token, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }

  if (!signedIn) {
    return (
      <SignInGate
        signIn={signIn}
        title="Sign in to enter the arena"
        copy="Conversations pick up in the same voice that roasted you and carry that roast as context the whole way through. Sign in to open one from a finished roast or a saved one in your history."
      />
    );
  }

  return (
    <div className="roaster-studio">

      <section className="rs-hero">
        <span className="rs-hero-badge">&#9889; Rebuttal Arena</span>
        <h1 className="rs-hero-title">Your Conversations</h1>
        <p className="rs-hero-copy">
          Every conversation you have going, newest activity first. Open one to keep
          talking to the voice that roasted you.
        </p>
      </section>

      <div className="rs-page">
        <div className="rs-col-controls">
          {loading && (
            <div className="rs-card">
              <span className="rs-idle-copy">loading…</span>
            </div>
          )}

          {!loading && error && (
            <div className="rs-card">
              <div className="rs-error">
                <div className="rs-error-top">
                  <span className="rs-error-icon">!</span>
                  <span className="rs-error-msg">Couldn't load your conversations.</span>
                </div>
                <span className="rs-error-detail">{error}</span>
              </div>
            </div>
          )}

          {!loading && !error && conversations.length === 0 && (
            <div className="rs-card">
              <div className="rs-idle">
                <span className="rs-idle-icon">&#9678;</span>
                <span className="rs-idle-title">Nothing here yet</span>
                <p className="rs-idle-copy">
                  Finish a roast and keep talking to the voice that gave it to you —
                  that's how every conversation here starts.
                </p>
                <Link to="/" className="rs-cta-btn">
                  <span>run a roast</span>
                  <span>&#8594;</span>
                </Link>
              </div>
            </div>
          )}

          {!loading && !error && conversations.length > 0 && (
            <div className="rs-card">
              <div className="rs-field-head">
                <span className="rs-field-label">Open conversations</span>
                <span className="rs-field-hint">{conversations.length}</span>
              </div>

              {deleteError && <p className="rs-convo-error">Couldn't delete that conversation — {deleteError}</p>}

              <div className="rs-convo-grid">
                {conversations.map((c) =>
                  confirmingId === c.id ? (
                    <div key={c.id} className="rs-convo-confirm">
                      <span className="rs-convo-confirm-text">Delete this conversation? This can't be undone.</span>
                      <span className="rs-convo-confirm-actions">
                        <button
                          type="button"
                          className="rs-convo-confirm-yes"
                          onClick={() => handleConfirmDelete(c.id)}
                          disabled={deletingId === c.id}
                        >
                          {deletingId === c.id ? "deleting…" : "delete"}
                        </button>
                        <button type="button" className="rs-convo-confirm-cancel" onClick={() => setConfirmingId(null)}>
                          cancel
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={c.id} className="rs-convo-row">
                      <Link to={`/chat/${c.id}`} className="rs-convo-link">
                        <div className="rs-convo-top">
                          <span className="rs-convo-persona">{personaName(c.persona) ?? c.persona}</span>
                          {c.type && <span className="rs-convo-kicker">{c.type}</span>}
                        </div>
                        <p className="rs-convo-message">{lastMessagePreview(c.lastMessage)}</p>
                        <div className="rs-convo-foot">
                          <span className="rs-convo-badge">{c.type ? c.type.toUpperCase() : "CHAT"}</span>
                          <span>{formatDate(c.createdAt)}</span>
                        </div>
                      </Link>
                      <button type="button" className="rs-convo-delete" onClick={() => setConfirmingId(c.id)}>
                        delete
                      </button>
                    </div>
                  )
                )}
              </div>

              {cursor && (
                <button type="button" className="rs-convo-load-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "loading…" : "load more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
