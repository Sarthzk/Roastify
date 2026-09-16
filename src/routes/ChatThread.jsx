import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { getConversation, sendChatMessage, deleteConversation } from "../lib/openai";
import { personaName } from "../lib/personas";
import { describeError } from "../lib/roasterErrors";
import ChatLockedPanel from "../components/ChatLockedPanel";

// Three generic conversation-starters for a brand-new thread — not persona- or
// severity-specific (the persona itself already sets the voice that answers them).
const QUICK_PROMPTS = ["what's the one thing to fix first", "is it really that bad", "give me a rewrite of my bio"];

// One conversation, at /chat/:id — the second half of chat, alongside ChatList.jsx (the
// /chat list). Both real entry points (a finished roast, a history row) land here
// directly, never on the list, and pass `state: { fresh: true }` through navigate() so
// this route can tell "just created" apart from "reopened" — a fresh conversation shows
// its roast context expanded immediately (the whole point of landing here instead of a
// blank screen is that the roast is visibly still there); a reopened one starts
// collapsed, since the transcript below it already carries that context.
export default function ChatThread() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session, signIn } = useOutletContext();
  const signedIn = Boolean(session);

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(signedIn);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(Boolean(location.state?.fresh));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sendError, setSendError] = useState(null);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const transcriptRef = useRef(null);

  // Same render-time-adjustment pattern History.jsx/ChatList.jsx use for a fresh token,
  // extended to a fresh :id too (navigating from one conversation straight to another,
  // e.g. two history rows in a row) — both need the same full reset. Tracking the token
  // here (not just `id`) matters for more than parity with those two: `loading`'s only
  // other assignment is its own `useState(signedIn)` initializer, which captures
  // `signedIn` once, on the very first render — since Layout's session always starts
  // `null` and resolves asynchronously, that first render always has `signedIn: false`,
  // so `loading` would otherwise get stuck `false` right up until this effect's fetch
  // finishes, with nothing re-deriving it in between once `signedIn` actually flips
  // true. This key catches exactly that transition and puts `loading` back in sync.
  const key = `${id}:${session?.access_token}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setLoading(signedIn);
    setLoadError(null);
    setConversation(null);
    setMessages([]);
    setExpanded(Boolean(location.state?.fresh));
    setSendError(null);
    setConfirmingDelete(false);
  }

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    getConversation(session.access_token, id)
      .then((data) => {
        if (cancelled) return;
        setConversation(data);
        setMessages(data.messages);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, session?.access_token, id]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  async function handleSend(rawContent) {
    const content = rawContent.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    setStreamingText("");
    setDraft("");
    try {
      const result = await sendChatMessage(session.access_token, id, content, { onChunk: setStreamingText });
      setMessages((prev) => [
        ...prev,
        { id: `${prev.length}-user`, role: "user", content, createdAt: new Date().toISOString() },
        {
          id: result.messageId ?? `${prev.length}-assistant`,
          role: "assistant",
          content: result.text,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (result.rateLimit) setRateLimitInfo(result.rateLimit);
    } catch (err) {
      // The draft comes back so a failed send doesn't lose what was typed — same
      // "no canned fallback, real error" posture the roast flow already has.
      setDraft(content);
      setSendError(describeError(err, {}));
      if (err.rateLimit) setRateLimitInfo(err.rateLimit);
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  function handleComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(draft);
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversation(session.access_token, id);
      navigate("/chat");
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  if (!signedIn) {
    return (
      <div>
        <section className="hero">
          <div className="hero-main">
            <h1 className="hero-title hero-title--small">Chat</h1>
            <div className="hero-rule hero-rule--small" />
            <p className="hero-copy">Chat is kept for signed-in accounts only.</p>
          </div>
        </section>
        <ChatLockedPanel signIn={signIn} />
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="row">
        <div className="row-label row-label--accent">Error</div>
        <div className="error-body">
          <div className="error-top">
            <span className="error-icon">!</span>
            <span className="error-msg">
              {loadError.code === "CONVERSATION_NOT_FOUND" ? "Conversation not found." : "Couldn't load this conversation."}
            </span>
          </div>
          <span className="error-detail">{loadError.message}</span>
        </div>
      </section>
    );
  }

  // Belt and suspenders alongside the `key` adjustment above: `loading` is derived from
  // the fetch, but nothing statically guarantees it's still true whenever `conversation`
  // isn't populated yet — a component render should never trust that kind of cross-state
  // invariant blindly. Treat "no conversation yet, and no error either" as still loading
  // rather than let the destructuring below crash on a null.
  if (loading || !conversation) {
    return (
      <section className="row">
        <div className="row-label">Chat</div>
        <div className="idle-body">
          <span className="idle-label">loading…</span>
        </div>
      </section>
    );
  }

  const persona = personaName(conversation.persona) ?? conversation.persona;
  const roast = conversation.roast;

  return (
    <div className="chat-thread">
      <section className="row chat-context-row">
        <div className="row-label">Chat</div>
        <div className="chat-context-bar">
          <div className="chat-context-head">
            <button type="button" className="chat-context-back" onClick={() => navigate("/")}>
              &#8249; back to roast
            </button>
            {/* Plain text, not a control — the persona is locked server-side for this
                conversation's whole lifetime (see api/conversations.js), so nothing here
                should look clickable or changeable. */}
            <span className="chat-context-persona">{persona}</span>
            {roast && (
              <span className="chat-context-meta">
                {roast.type}
                {roast.severity ? ` · ${roast.severity}` : ""}
              </span>
            )}
            {rateLimitInfo && (
              <span className="chat-context-rate">
                {rateLimitInfo.remaining} of {rateLimitInfo.limit} messages left today
              </span>
            )}
            <span className="chat-context-spacer" />
            {roast && (
              <button type="button" className="chat-context-toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "hide roast" : "view roast"}
              </button>
            )}
          </div>

          {expanded && roast && (
            <div className="chat-context-roast">
              <p className="chat-context-roast-text">{roast.roast}</p>
              {roast.tips?.length > 0 && (
                <ul className="chat-context-tips">
                  {roast.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="chat-context-danger">
            {!confirmingDelete ? (
              <button type="button" className="chat-context-delete" onClick={() => setConfirmingDelete(true)}>
                delete conversation
              </button>
            ) : (
              <div className="privacy-confirm">
                <span className="hist-row-confirm-text">Delete this conversation? This can't be undone.</span>
                <span className="hist-row-confirm-actions">
                  <button type="button" className="hist-row-confirm-yes" onClick={handleConfirmDelete} disabled={deleting}>
                    {deleting ? "deleting…" : "yes, delete it"}
                  </button>
                  <button
                    type="button"
                    className="hist-row-confirm-cancel"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    cancel
                  </button>
                </span>
              </div>
            )}
            {deleteError && <p className="privacy-error">Couldn't delete this conversation — {deleteError}</p>}
          </div>
        </div>
      </section>

      <div className="chat-transcript" ref={transcriptRef}>
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            <div className="chat-empty-title">Nothing here yet</div>
            <p className="chat-empty-copy">
              Ask {persona} to go deeper on the roast, defend yourself, or start with one of these.
            </p>
            <div className="chat-chips">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" className="chat-chip" onClick={() => handleSend(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`chat-message chat-message--${m.role}`}>
            <span className="chat-message-role">{m.role === "user" ? "you" : persona}</span>
            <p className="chat-message-text">{m.content}</p>
          </div>
        ))}

        {sending && (
          <div className="chat-message chat-message--assistant">
            <span className="chat-message-role">{persona}</span>
            <p className="chat-message-text">
              {streamingText}
              <span className="caret caret--sm" />
            </p>
          </div>
        )}

        {sendError && (
          <div className="error-body chat-message-error">
            <div className="error-top">
              <span className="error-icon">!</span>
              <span className="error-msg">{sendError.message}</span>
            </div>
            <span className="error-detail">{sendError.detail}</span>
            {sendError.retryable && (
              <button type="button" className="retry" onClick={() => handleSend(draft)}>
                <span>try again</span>
                <span>&#8594;</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chat-composer">
        <textarea
          className="chat-composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={`Say something to ${persona.toLowerCase()}…`}
          disabled={sending}
        />
        <button
          type="button"
          className="chat-composer-send"
          onClick={() => handleSend(draft)}
          disabled={sending || !draft.trim()}
        >
          {sending ? "sending" : "send"}
        </button>
      </div>
    </div>
  );
}
