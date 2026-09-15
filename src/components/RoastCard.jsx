import { useRef, useState } from "react";
import html2canvas from "html2canvas";

// Owns all Output states — idle / streaming / error / invitation / complete — exactly
// one renders at a time, matching the handoff's own component-mapping table.
export default function RoastCard({
  status,
  roast,
  tips,
  error,
  type,
  severity,
  personaName,
  modelUsed,
  signedIn,
  onRetry,
  onRoastAnother,
  onSignIn,
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
      const canvas = await html2canvas(cardRef.current, {
        // html2canvas passes this straight to a canvas fillStyle, which doesn't resolve
        // CSS custom properties — must stay a literal hex, unlike every other color in
        // this file (kept in sync with --ground-2 in src/index.css).
        backgroundColor: "#0a0a0a",
        scale: 2,
      });
      const link = document.createElement("a");
      link.download = "roastify-roast.png";
      link.href = canvas.toDataURL();
      link.click();
    } finally {
      setGenerating(false);
    }
  }

  if (status === "idle") {
    return (
      <section className="row">
        <div className="row-label">Output</div>
        <div className="idle-body">
          <span className="idle-label">awaiting input</span>
          <span className="idle-cursor" />
        </div>
      </section>
    );
  }

  if (status === "streaming") {
    // Two real lifecycle states, not a timer: no roast text has arrived yet vs. tokens
    // are actively streaming in. No fake "stages" tied to a fixed clock or to GitHub-
    // specific flavor text — that would misrepresent what's actually happening, and
    // would read as a bug on a non-GitHub roast.
    const streamStage = roast.length === 0 ? "reading profile…" : "printing…";
    return (
      <section className="row">
        <div className="row-label row-label--accent">Generating</div>
        <div className="out-body">
          <div className="stream-line">{streamStage}</div>
          <p className="stream-text">
            {roast}
            <span className="caret" />
          </p>
        </div>
      </section>
    );
  }

  if (status === "error") {
    // A signed-out user hitting the server's Instagram sign-in gate is a tier boundary,
    // not a failure — it must never render as a labelled error row (see CLAUDE.md's
    // "Auth & persistence"). In normal use the locked source cell prevents this from
    // ever being reached; this only covers a session expiring mid-flow.
    if (error.code === "SIGN_IN_REQUIRED") {
      return (
        <section className="row">
          <div className="row-label">Output</div>
          <div className="invitation-body">
            <div className="invitation-top">
              <span className="invitation-icon">&#8226;</span>
              <span className="invitation-msg">{error.message}</span>
            </div>
            <div className="invitation-actions">
              <button type="button" className="source-prompt-provider" onClick={() => onSignIn("github")}>
                github
              </button>
              <button type="button" className="source-prompt-provider" onClick={() => onSignIn("google")}>
                google
              </button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="row error-enter">
        <div className="row-label row-label--accent">Error</div>
        <div className="error-body">
          <div className="error-top">
            <span className="error-icon">!</span>
            <span className="error-msg">{error.message}</span>
          </div>
          <span className="error-detail">{error.detail}</span>
          {error.retryable && (
            <button type="button" className="retry" onClick={onRetry}>
              <span>try again</span>
              <span>&#8594;</span>
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="result-enter">
      <div ref={cardRef}>
        <section className="row row--thin">
          <div className="row-label row-label--accent">
            Roast{import.meta.env.DEV && modelUsed ? ` · ${modelUsed}` : ""}
          </div>
          <div className="out-body">
            <p className="roast-body">{roast}</p>
          </div>
        </section>

        <section className="row meta-row">
          <div className="row-label" />
          <div className="meta-line">
            {type} · {personaName} · {severity}
            {signedIn ? " · saved" : ""}
          </div>
        </section>

        <section className="row">
          <div className="row-label fixes-label">
            Fixes<br className="fixes-label-break" />
            <span className="fixes-label-count">
              {checked.length}/{tips.length}
            </span>
          </div>
          <div>
            {tips.map((tip, i) => {
              const isChecked = checked.includes(i);
              return (
                <label key={i} className={`fix-row${isChecked ? " is-checked" : ""}`}>
                  <span className="fix-row-checkbox">
                    <input
                      type="checkbox"
                      className="fix-row-checkbox-input"
                      checked={isChecked}
                      onChange={() => toggle(i)}
                    />
                    {isChecked && "✓"}
                  </span>
                  <span className="fix-row-text">{tip}</span>
                </label>
              );
            })}
          </div>
        </section>
      </div>

      <section className="row">
        <div className="row-label" />
        <div className="actions-grid">
          <button
            type="button"
            className={`action-btn action-btn--share${copied ? " is-copied" : ""}`}
            onClick={handleShare}
          >
            {copied ? "copied." : "share roast"}
          </button>
          <button type="button" className="action-btn" onClick={handleSaveAsImage} disabled={generating}>
            {generating ? "generating..." : "save as image"}
          </button>
          <button type="button" className="action-btn" onClick={onRoastAnother}>
            roast another
          </button>
        </div>
      </section>
    </div>
  );
}
