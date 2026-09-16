import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getConversations, deleteConversation } from "../lib/openai";
import { personaName } from "../lib/personas";
import { formatDate, lastMessagePreview } from "../lib/chatHelpers";
import ChatLockedPanel from "../components/ChatLockedPanel";

// Count-aware closing panel, same role as History.jsx's nextPanelCopy — the list's own
// terminator, no separate footer CTA. "run a roast" is the only way into a conversation
// that doesn't already exist (see CLAUDE.md's "Chat" section: both real entry points,
// a finished roast or a history row, skip this list and open /chat/:id directly).
function nextPanelCopy(count) {
  if (count === 0) {
    return {
      label: "Empty",
      title: "Nothing here yet.",
      body: "Finish a roast and keep talking to the voice that gave it to you — that's how every conversation here starts.",
      cta: "run a roast",
    };
  }
  return {
    label: "Next",
    title: count === 1 ? "One conversation going." : `${count} conversations going.`,
    body: "Start another from any finished roast, or from a row in your history.",
    cta: "run a roast",
  };
}

// Signed-in only — a signed-out visitor gets a locked panel here (never a redirect, so a
// shared /chat link isn't a dead end — same reasoning as History.jsx). Landing on /chat
// directly shows this list; both real entry points into a conversation (a finished roast,
// a history row) skip straight to /chat/:id instead.
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

  const next = nextPanelCopy(conversations.length);

  return (
    <div>
      <section className="hero">
        <div className="hero-main">
          <h1 className="hero-title hero-title--small">Chat</h1>
          <div className="hero-rule hero-rule--small" />
          <p className="hero-copy">
            {signedIn
              ? "Every conversation you have going, newest activity first. Open one to keep talking."
              : "Chat is kept for signed-in accounts only."}
          </p>
        </div>
      </section>

      {!signedIn && <ChatLockedPanel signIn={signIn} />}

      {signedIn && loading && (
        <section className="row">
          <div className="row-label">Open</div>
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
              <span className="error-msg">Couldn't load your conversations.</span>
            </div>
            <span className="error-detail">{error}</span>
          </div>
        </section>
      )}

      {signedIn && !loading && !error && (
        <>
          {conversations.length > 0 && (
            <section className="row">
              <div className="row-label">
                Open <span className="history-list-label">{conversations.length}</span>
              </div>
              {deleteError && <p className="hist-delete-error">Couldn't delete that conversation — {deleteError}</p>}
              <div>
                {conversations.map((c) =>
                  confirmingId === c.id ? (
                    <div key={c.id} className="hist-row hist-row-confirm">
                      <span className="hist-row-confirm-text">Delete this conversation? This can't be undone.</span>
                      <span className="hist-row-confirm-actions">
                        <button
                          type="button"
                          className="hist-row-confirm-yes"
                          onClick={() => handleConfirmDelete(c.id)}
                          disabled={deletingId === c.id}
                        >
                          {deletingId === c.id ? "deleting…" : "delete"}
                        </button>
                        <button type="button" className="hist-row-confirm-cancel" onClick={() => setConfirmingId(null)}>
                          cancel
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={c.id} className="hist-row">
                      <Link to={`/chat/${c.id}`} className="chat-row-open">
                        <span className="chat-row-top">
                          <span className="chat-row-kicker">
                            {(personaName(c.persona) ?? c.persona).toUpperCase()}
                            {c.type ? ` · ${c.type.toUpperCase()}` : ""}
                          </span>
                          <span className="chat-row-date">{formatDate(c.createdAt)}</span>
                        </span>
                        <span className="chat-row-message">{lastMessagePreview(c.lastMessage)}</span>
                      </Link>
                      <button type="button" className="hist-row-delete" onClick={() => setConfirmingId(c.id)}>
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
