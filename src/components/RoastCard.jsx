import { useRef, useState } from "react";
import VerdictCard from "./VerdictCard";
import { exportCardAsImage } from "../lib/exportCard";

// Owns all Output states — idle / streaming / error / invitation / complete — exactly
// one renders at a time, matching the handoff's own component-mapping table.
export default function RoastCard({
  status,
  roast,
  tips,
  error,
  type,
  identifier,
  severity,
  persona,
  modelUsed,
  signedIn,
  onRetry,
  onRoastAnother,
  onSignIn,
  onStartChat,
  startingChat,
  chatError,
}) {
  const [checked, setChecked] = useState([]);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const cardRef = useRef();

  // A fresh roast (including the empty tips array right after "roast another") should
  // never carry over which boxes were ticked on the previous one. Adjusting state during
  // render (rather than in an effect) per React's own guidance for "reset state when a
  // prop changes" — avoids the extra render pass an effect would cost.
  const [prevTips, setPrevTips] = useState(tips);
  if (tips !== prevTips) {
    setPrevTips(tips);
    setChecked([]);
  }

  function toggle(i) {
    setChecked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  }

  async function handleShare() {
    const shareText = `I got roasted by Roastify 🔥

${roast}

get roasted at roastify.vercel.app`;

    if (navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        // fall through to clipboard copy if native share fails for any other reason
      }
    }

    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleSaveAsImage() {
    if (!cardRef.current || generating) return;

    setGenerating(true);
    try {
      await exportCardAsImage(cardRef.current, "roastify-roast.png");
    } finally {
      setGenerating(false);
    }
  }

  // Only github/instagram's `identifier` is a real, displayable handle/URL — strip it
  // down to the bare username (no protocol, no "github.com/"), never the full pasted
  // URL. linkedin/resume have no handle to show, so it's a plain, honest label derived
  // from `type` instead, never fabricated.
  const handle = identifier?.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^(github|instagram)\.com\//i, "").replace(/\/+$/, "");
  const targetEcho = handle || (type === "linkedin" ? "LinkedIn PDF" : type === "resume" ? "Resume" : "target_undefined");

  const head = (
    <div className="rs-verdict-head">
      <span className="rs-verdict-id">
        <span className="rs-verdict-dot" />
        Verdict
      </span>
      <span className="rs-verdict-target">
        <span className="rs-verdict-target-label">Target:</span>
        <span className="rs-verdict-target-value">{targetEcho}</span>
      </span>
    </div>
  );

  if (status === "idle") {
    return (
      <div className="rs-verdict">
        {head}
        <div className="rs-verdict-body">
          <div className="rs-idle">
            <span className="rs-idle-icon">&#9678;</span>
            <span className="rs-idle-title">Awaiting target</span>
            <p className="rs-idle-copy">
              Pick a source on the left, dial in an intensity and an executioner, then run
              the audit. No sugar-coating, no corporate fluff.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "streaming") {
    // Two real lifecycle states, not a timer: no roast text has arrived yet vs. tokens
    // are actively streaming in. No fake "stages" tied to a fixed clock.
    const streamStage = roast.length === 0 ? "reading profile…" : "printing…";
    return (
      <div className="rs-verdict">
        {head}
        <div className="rs-verdict-body">
          <div className="rs-stream-label">{streamStage}</div>
          <p className="rs-stream-text">
            {roast}
            <span className="rs-caret" />
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    // A signed-out user hitting the server's Instagram sign-in gate is a tier boundary,
    // not a failure — it must never render as a labelled error row (see CLAUDE.md's
    // "Auth & persistence"). In normal use the locked source cell prevents this from
    // ever being reached; this only covers a session expiring mid-flow.
    if (error.code === "SIGN_IN_REQUIRED") {
      return (
        <div className="rs-verdict">
          {head}
          <div className="rs-verdict-body">
            <div className="rs-invitation">
              <div className="rs-invitation-top">
                <span className="rs-invitation-icon">&#8226;</span>
                <span className="rs-invitation-msg">{error.message}</span>
              </div>
              <div className="rs-invitation-actions">
                <button type="button" className="rs-invitation-btn" onClick={() => onSignIn("github")}>
                  github
                </button>
                <button type="button" className="rs-invitation-btn" onClick={() => onSignIn("google")}>
                  google
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="rs-verdict">
        {head}
        <div className="rs-verdict-body">
          <div className="rs-error">
            <div className="rs-error-top">
              <span className="rs-error-icon">!</span>
              <span className="rs-error-msg">{error.message}</span>
            </div>
            <span className="rs-error-detail">{error.detail}</span>
            {error.retryable && (
              <button type="button" className="rs-retry" onClick={onRetry}>
                <span>try again</span>
                <span>&#8594;</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <VerdictCard
      ref={cardRef}
      identifier={identifier}
      type={type}
      severity={severity}
      persona={persona}
      modelUsed={modelUsed}
      roast={roast}
      tips={tips}
      checked={checked}
      onToggle={toggle}
    >
      <div className="rs-actions">
        <div className="rs-actions-left">
          <button type="button" className={`rs-action-btn${copied ? " is-copied" : ""}`} onClick={handleShare}>
            {copied ? "copied." : "share"}
          </button>
          <button type="button" className="rs-action-btn rs-action-btn--accent" onClick={handleSaveAsImage} disabled={generating}>
            {generating ? "generating…" : "export card"}
          </button>
          <button type="button" className="rs-action-btn" onClick={onRoastAnother}>
            try another
          </button>
        </div>

        {signedIn ? (
          <button type="button" className="rs-cta-btn" onClick={onStartChat} disabled={startingChat}>
            <span>{startingChat ? "starting…" : "fight me"}</span>
            <span>&#8594;</span>
          </button>
        ) : (
          <span className="rs-invitation-actions">
            <span className="rs-error-detail">sign in to chat</span>
            <button type="button" className="rs-invitation-btn" onClick={() => onSignIn("github")}>
              github
            </button>
            <button type="button" className="rs-invitation-btn" onClick={() => onSignIn("google")}>
              google
            </button>
          </span>
        )}
      </div>
      {chatError && <p className="rs-cta-error">Couldn't start that conversation &mdash; {chatError}</p>}
    </VerdictCard>
  );
}
