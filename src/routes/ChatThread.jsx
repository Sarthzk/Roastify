import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { getConversation, sendChatMessage, deleteConversation } from "../lib/openai";
import { PERSONAS, personaName } from "../lib/personas";
import { describeError } from "../lib/roasterErrors";
import { SEVERITY_LABELS } from "../lib/severity";
import SignInGate from "../components/SignInGate";

// Mirrors api/messages.js's own MAX_MESSAGE_LENGTH — a server file, not importable from
// the client bundle, so this is a deliberate duplicate of a real constant (same
// necessity as RoastCard.jsx's html2canvas backgroundColor mirroring --ground-2). The
// mockup's own "/1000" was fabricated; this is the actual server-side cap.
const MAX_MESSAGE_LENGTH = 4000;

// Per-message header time, matching the mockup's "12:34 PM" treatment — a small
// presentation-only formatter, derived straight from real `createdAt` data.
function formatMessageTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

function draftStorageKey(id) {
  return `roastify:chat-draft:${id}`;
}
function loadSavedDraft(id) {
  try {
    return localStorage.getItem(draftStorageKey(id)) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(id, text) {
  try {
    if (text) localStorage.setItem(draftStorageKey(id), text);
    else localStorage.removeItem(draftStorageKey(id));
  } catch {
    // localStorage can throw (private mode, blocked site data) — the draft just
    // doesn't persist across a reload in that case, nothing else depends on it.
  }
}

// One conversation, at /chat/:id — the second half of chat, alongside ChatList.jsx (the
// /chat list). Both real entry points (a finished roast, a history row) land here
// directly, never on the list.
export default function ChatThread() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session, signIn } = useOutletContext();
  const signedIn = Boolean(session);

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(signedIn);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sendError, setSendError] = useState(null);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const transcriptRef = useRef(null);

  // Same render-time-adjustment pattern History.jsx/ChatList.jsx use for a fresh token,
  // extended to a fresh :id too. Tracking the token here (not just `id`) matters for
  // more than parity with those two: `loading`'s only other assignment is its own
  // `useState(signedIn)` initializer, which captures `signedIn` once, on the very first
  // render — since Layout's session always starts `null` and resolves asynchronously,
  // that first render always has `signedIn: false`, so `loading` would otherwise get
  // stuck `false` right up until this effect's fetch finishes. This key catches exactly
  // that transition and puts `loading` back in sync.
  const key = `${id}:${session?.access_token}`;
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setLoading(signedIn);
    setLoadError(null);
    setConversation(null);
    setMessages([]);
    setDraft(loadSavedDraft(id));
    setSendError(null);
    setConfirmingDelete(false);
    setRateLimitInfo(null);
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

  function handleDraftChange(value) {
    setDraft(value);
    saveDraft(id, value);
  }

  async function handleSend(rawContent) {
    const content = rawContent.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    setStreamingText("");
    setDraft("");
    saveDraft(id, "");
    // Optimistic: the user's own message shows up the instant they hit send, not only
    // once the persona's reply comes back — this temp id lets the error path below roll
    // it back out again (rather than leaving a message on screen that was never really
    // delivered) if the send fails, so a retry doesn't duplicate it.
    const tempId = `pending-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: "user", content, createdAt: new Date().toISOString() }]);
    try {
      const result = await sendChatMessage(session.access_token, id, content, { onChunk: setStreamingText });
      setMessages((prev) => [
        ...prev,
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
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(content);
      saveDraft(id, content);
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

  // Copy affordance on a persona reply. Purely local UI sugar over text already on
  // screen; nothing new is fetched or stored.
  async function handleCopy(msgId, content) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId((current) => (current === msgId ? null : current)), 1500);
    } catch {
      // Clipboard access can be denied by the browser — silently ignored; there's no
      // fallback UI for that case, same as the rest of this app's clipboard use.
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteConversation(session.access_token, id);
      saveDraft(id, "");
      navigate("/chat");
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
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

  if (loadError) {
    return (
      <div className="roaster-studio">
        <div className="rs-page">
          <div className="rs-card">
            <div className="rs-error">
              <div className="rs-error-top">
                <span className="rs-error-icon">!</span>
                <span className="rs-error-msg">
                  {loadError.code === "CONVERSATION_NOT_FOUND" ? "Conversation not found." : "Couldn't load this conversation."}
                </span>
              </div>
              <span className="rs-error-detail">{loadError.message}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Belt and suspenders: `loading` is derived from the fetch, but nothing statically
  // guarantees it's still true whenever `conversation` isn't populated yet — treat "no
  // conversation yet, and no error either" as still loading rather than trust that
  // cross-state invariant blindly.
  if (loading || !conversation) {
    return (
      <div className="roaster-studio">
        <div className="rs-page">
          <div className="rs-card">
            <span className="rs-idle-copy">loading…</span>
          </div>
        </div>
      </div>
    );
  }

  const persona = PERSONAS.find((p) => p.value === conversation.persona);
  const displayName = personaName(conversation.persona) ?? conversation.persona;
  const roast = conversation.roast;
  const handle = roast?.identifier
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^(github|instagram)\.com\//i, "")
    .replace(/\/+$/, "");
  const targetLabel =
    handle || (roast?.type === "linkedin" ? "LinkedIn PDF" : roast?.type === "resume" ? "Resume" : "target_undefined");
  const shortId = id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const quickRetorts = persona?.quickRetorts ?? [];

  return (
    <div className="roaster-studio">

      <section className="rs-hero">
        <span className="rs-hero-badge">&#9889; Rebuttal Arena</span>
        <span className="rs-hero-badge rs-hero-badge--alt">&#128308; Active Confrontation</span>
        <h1 className="rs-hero-title">Confront your critic</h1>
        <p className="rs-hero-copy">
          Challenge the diagnosis, debate your choices, or demand a concrete fix.
          Unfiltered multi-turn rebuttal against the persona that roasted you.
        </p>
      </section>

      <div className="rs-grid">
        <aside className="rs-col-controls">
          {/* 01. Active target & verdict — recap of the original roast this
              conversation is attached to. "Tech stack audit" from the mockup is
              dropped entirely: nothing in the roast/report data detects or stores a
              tech stack, so there's no real value to bind it to. */}
          <div className="rs-verdict rs-verdict--compact">
            <div className="rs-verdict-head">
              <span className="rs-verdict-id">
                <span className="rs-verdict-dot" />
                01. Target &amp; verdict
              </span>
            </div>
            <div className="rs-verdict-body">
              <div className="rs-target-pill">
                <span className="rs-target-pill-value">{targetLabel}</span>
              </div>

              {roast?.roast && (
                <div className="rs-original-verdict">
                  <span className="rs-original-verdict-tag">Original verdict</span>
                  <p className="rs-original-verdict-text">&#8220;{roast.roast}&#8221;</p>
                </div>
              )}

              {roast?.severity && (
                <div className="rs-meta-cell">
                  <span className="rs-meta-cell-label">Heat intensity</span>
                  <span className="rs-meta-cell-value rs-meta-cell-value--coral">
                    {SEVERITY_LABELS[roast.severity] ?? roast.severity} &#128293;
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 02. Executioner persona — locked to whatever the original roast used, no
              ability to switch mid-conversation; only the engaged persona is shown. */}
          <div className="rs-verdict rs-verdict--compact">
            <div className="rs-verdict-head">
              <span className="rs-verdict-id">02. Executioner persona</span>
            </div>
            <div className="rs-verdict-body">
              <div className="rs-persona-card is-selected is-static">
                <span className="rs-persona-main">
                  <span className="rs-persona-icon">{persona?.icon ?? "?"}</span>
                  <span className="rs-persona-body">
                    <span className="rs-persona-name">{displayName}</span>
                    {persona?.tagline && <p className="rs-persona-note">{persona.tagline}</p>}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* 03. Telemetry & quota — the rebuttals-remaining meter only ever shows a
              real number: rateLimitInfo starts null and only ever gets set from a real
              POST /api/messages response, so there's nothing to draw until the first
              send (see CLAUDE.md's "Chat" section). The mockup's "Ego Defended 12%
              Recovering" metric and its two session-action buttons ("re-run profile
              audit" / "export verdict dossier") are dropped — no backend field for the
              former, no described requirement or existing mechanism for the latter. */}
          <div className="rs-verdict rs-verdict--compact">
            <div className="rs-verdict-head">
              <span className="rs-verdict-id">03. Telemetry &amp; quota</span>
              <span className="quota-badge-dot" />
            </div>
            <div className="rs-verdict-body">
              {rateLimitInfo ? (
                <div>
                  <div className="rs-quota-row">
                    <span>Rebuttals remaining</span>
                    <span>
                      {rateLimitInfo.remaining} / {rateLimitInfo.limit}
                    </span>
                  </div>
                  <div className="rs-quota-track">
                    <div
                      className="rs-quota-fill"
                      style={{ width: `${Math.max(0, Math.min(100, (rateLimitInfo.remaining / rateLimitInfo.limit) * 100))}%` }}
                    />
                  </div>
                </div>
              ) : (
                <span className="rs-quota-empty">Shows after your first message today.</span>
              )}

              {!confirmingDelete ? (
                <button type="button" className="rs-demo-btn rs-panel-action" onClick={() => setConfirmingDelete(true)}>
                  delete conversation
                </button>
              ) : (
                <div className="rs-convo-confirm rs-panel-action">
                  <span className="rs-convo-confirm-text">Delete this conversation? This can't be undone.</span>
                  <span className="rs-convo-confirm-actions">
                    <button type="button" className="rs-convo-confirm-yes" onClick={handleConfirmDelete} disabled={deleting}>
                      {deleting ? "deleting…" : "yes, delete it"}
                    </button>
                    <button type="button" className="rs-convo-confirm-cancel" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                      cancel
                    </button>
                  </span>
                </div>
              )}
              {deleteError && <p className="rs-convo-error">Couldn't delete this conversation — {deleteError}</p>}
            </div>
          </div>
        </aside>

        <main className="rs-col-verdict">
          <div className="rs-verdict">
            <div className="rs-verdict-head">
              <span className="rs-verdict-id">
                <span className="rs-verdict-dot" />
                Session {shortId}
              </span>
              <span className="rs-verdict-target">
                <span className="rs-verdict-target-label">Target:</span>
                <span className="rs-verdict-target-value">{targetLabel}</span>
              </span>
            </div>

            <div className="rs-thread" ref={transcriptRef}>
              {messages.length === 0 && !sending && (
                <div className="rs-chat-empty">
                  <div className="rs-chat-empty-title">Nothing here yet</div>
                  <p className="rs-chat-empty-copy">
                    Ask {displayName} to go deeper on the roast, defend yourself, or start with one of these.
                  </p>
                </div>
              )}

              {messages.map((m, i) => {
                const isUser = m.role === "user";
                // Cosmetic-only "delivered/parsed" stamp — real once the reply that
                // followed this message has actually arrived (there's a later message
                // in the list), no backend field needed. The user's own message now
                // appears the instant it's sent (see handleSend's optimistic add), so
                // this can no longer just check `sending` — that's true from the moment
                // of sending, before any reply exists.
                const delivered = isUser && i < messages.length - 1;
                return (
                  <div key={m.id} className={`rs-msg${isUser ? " rs-msg--user" : ""}`}>
                    <div className="rs-msg-meta">
                      {!isUser && <span className="rs-msg-avatar">{persona?.icon ?? "?"}</span>}
                      <span className="rs-msg-role">{isUser ? "You (Defendant)" : displayName}</span>
                      {m.createdAt && <span className="rs-msg-time">{formatMessageTime(m.createdAt)}</span>}
                    </div>
                    <div className="rs-msg-bubble">
                      <p className="rs-msg-text">{m.content}</p>
                      {!isUser && (
                        <div className="rs-msg-foot">
                          <button type="button" className="rs-msg-copy" onClick={() => handleCopy(m.id, m.content)}>
                            {copiedId === m.id ? "copied" : "copy"}
                          </button>
                        </div>
                      )}
                      {delivered && (
                        <div className="rs-msg-foot">
                          <span className="rs-msg-stamp">&#10003;&#10003; delivered &amp; parsed</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {sending && (
                <div className="rs-msg">
                  <div className="rs-msg-meta">
                    <span className="rs-msg-avatar">{persona?.icon ?? "?"}</span>
                    <span className="rs-msg-role">{displayName}</span>
                  </div>
                  <div className="rs-msg-bubble">
                    <p className="rs-msg-text">
                      {streamingText}
                      <span className="rs-caret" />
                    </p>
                  </div>
                </div>
              )}

              {sendError && (
                <div className="rs-error">
                  <div className="rs-error-top">
                    <span className="rs-error-icon">!</span>
                    <span className="rs-error-msg">{sendError.message}</span>
                  </div>
                  <span className="rs-error-detail">{sendError.detail}</span>
                  {sendError.retryable && (
                    <button type="button" className="rs-retry" onClick={() => handleSend(draft)}>
                      <span>try again</span>
                      <span>&#8594;</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {quickRetorts.length > 0 && (
              <div className="rs-retort-bar">
                <span className="rs-retort-label">&#9889; Quick counter-argument injectors</span>
                <div className="rs-retort-grid">
                  {quickRetorts.map((prompt) => (
                    <button key={prompt} type="button" className="rs-retort-chip" onClick={() => handleSend(prompt)} disabled={sending}>
                      &#8220;{prompt}&#8221;
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rs-composer">
              <textarea
                className="rs-composer-textarea"
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={`Say something to ${displayName.toLowerCase()}…`}
                disabled={sending}
              />
              <div className="rs-composer-footer">
                <div className="rs-composer-status">
                  <span className={`rs-composer-count${draft.length > MAX_MESSAGE_LENGTH ? " rs-composer-count--over" : ""}`}>
                    {draft.length} / {MAX_MESSAGE_LENGTH} chars
                  </span>
                  {draft && (
                    <span className="rs-composer-saved">
                      <span className="rs-composer-saved-dot" />
                      draft saved
                    </span>
                  )}
                </div>
                <div className="rs-composer-actions">
                  <button
                    type="button"
                    className="rs-composer-clear"
                    onClick={() => handleDraftChange("")}
                    disabled={sending || !draft}
                  >
                    clear
                  </button>
                  <button type="button" className="rs-composer-send" onClick={() => handleSend(draft)} disabled={sending || !draft.trim()}>
                    <span>{sending ? "sending…" : "dispatch"}</span>
                    <span>&#8629;</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="rs-safety-note">
            <span>&#128737;</span>
            <span>Safety: strict satire protocol loaded</span>
          </div>
        </main>
      </div>
    </div>
  );
}
