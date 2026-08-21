import { useEffect, useRef, useState } from "react";
import InputForm from "./components/InputForm";
import RoastCard from "./components/RoastCard";
import { getRoast, getRateLimitStatus } from "./lib/openai";
import { DEFAULT_PERSONA, personaName } from "./lib/personas";

function formatCountdown(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// Turns a thrown error (see src/lib/openai.js's errorFromEnvelope) into the message/
// detail/retryable shape the Output error state renders. `detail` is synthesized from
// real data only — never fabricated: a rate-limit error gets a real countdown from the
// error's own attached rateLimit snapshot; a scrape-family error names the source type
// that was checked (never the raw submitted text — could be pasted resume/profile
// content); everything else falls back to a plain machine code.
function describeError(err, { type }) {
  const codeSlug = (err.code || "unknown").toLowerCase();
  let detail;
  if (err.code === "RATE_LIMITED" && err.rateLimit?.reset) {
    detail = `rate limit reached · resets in ${formatCountdown(err.rateLimit.reset - Date.now())} · err_${codeSlug}`;
  } else if (err.code && err.code.startsWith("SCRAPE_")) {
    detail = `checked ${type} · err_${codeSlug}`;
  } else {
    detail = `err_${codeSlug}`;
  }
  return { message: err.message, detail, retryable: Boolean(err.retryable) };
}

export default function App() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("github");
  const [severity, setSeverity] = useState("medium");
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [model, setModel] = useState("gpt-4o");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const outputRef = useRef(null);
  const hasScrolledToOutputRef = useRef(false);

  const status = loading ? "streaming" : error ? "error" : result ? "complete" : "idle";
  const instagramEnabled = rateLimitStatus?.instagramEnabled ?? true;
  const rateLimit = { limit: rateLimitStatus?.limit ?? 5, remaining: rateLimitStatus?.remaining ?? 5 };
  const disabled = !url.trim() || loading;

  useEffect(() => {
    getRateLimitStatus().then(setRateLimitStatus).catch(() => {});
  }, []);

  // If Instagram gets disabled mid-session (the kill switch flips underneath a user who
  // already had it selected), fall back to a source that's still available.
  useEffect(() => {
    if (!instagramEnabled && type === "instagram") {
      setType("github");
      setUrl("");
    }
  }, [instagramEnabled, type]);

  // Auto-scroll to the Output section — not at submit time. Scrolling immediately on
  // submit measures the Output section while the page is still short (idle state), and
  // window.scrollTo clamps its target to the page's height *at the moment it's called*
  // — it doesn't keep advancing on its own as streamed content grows the page taller
  // afterward. Confirmed empirically: scrolling on submit landed at the page's then-max
  // scrollable position, ~650px short of the Output section; even scrolling on the
  // first streamed chunk still landed short, since the page is only slightly taller at
  // that point than it was at submit time — the real growth (the rest of the roast,
  // then the meta/fixes/actions rows) all happens after.
  //
  // Two triggers, so the scroll is both responsive and eventually correct:
  // 1. As soon as there's anything to see (first chunk, or an immediate error) — once
  //    per request (`hasScrolledToOutputRef`), so the ~100+ chunks in a streamed roast
  //    don't each trigger a re-scroll.
  // 2. Once more when the request reaches a terminal state (complete or error) — by
  //    then the page has grown to its real final height, so this corrects for whatever
  //    the first scroll's clamped target undershot.
  useEffect(() => {
    function scrollToOutput() {
      const outputTop = outputRef.current?.getBoundingClientRect().top;
      if (outputTop !== undefined) {
        window.scrollTo({ top: window.scrollY + outputTop, behavior: "smooth" });
      }
    }

    if ((result?.roast || error) && !hasScrolledToOutputRef.current) {
      hasScrolledToOutputRef.current = true;
      scrollToOutput();
    }
    if (status === "complete" || status === "error") {
      scrollToOutput();
    }
  }, [result?.roast, error, status]);

  function handleTypeChange(newType) {
    setType(newType);
    setUrl("");
  }

  function handleRoastAnother() {
    setResult(null);
    setError(null);
    setUrl("");
    // Remounts InputForm, clearing its local upload state (the file confirmation card,
    // upload status/error) for free — see CLAUDE.md's "Frontend structure" for why that
    // state stays local rather than living here.
    setResetKey((k) => k + 1);
  }

  async function handleSubmit() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    hasScrolledToOutputRef.current = false;
    try {
      // Production users can't select a model (the picker only renders in dev — see
      // InputForm.jsx) — don't send a `model` field at all outside dev, so there's
      // nothing for a modified client to spoof. The server pins production regardless
      // (resolveProductionSafeModelOption in api/roast.js is the real security boundary).
      // Persona, unlike model, is a real production feature and always sent — the
      // server validates it via resolvePersona regardless (api/_lib/prompts/personas.js).
      const data = await getRoast(url, type, severity, import.meta.env.DEV ? model : undefined, persona, {
        onRoastChunk: (text) => setResult((prev) => ({ ...prev, roast: text, tips: prev?.tips || [] })),
      });
      setResult(data);
      // Merge, don't replace — data.rateLimit only ever carries limit/remaining/reset,
      // never instagramEnabled (that's only in the page-load /api/rate-limit-status
      // response), so a plain replace would silently un-hide a disabled Instagram card.
      if (data.rateLimit) setRateLimitStatus((prev) => ({ ...prev, ...data.rateLimit }));
    } catch (err) {
      // No canned roast on failure anymore (see api/roast.js) — show the real message.
      setResult(null);
      setError(describeError(err, { type }));
      if (err.rateLimit) setRateLimitStatus((prev) => ({ ...prev, ...err.rateLimit }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-root">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">Roastify</span>
        </div>
        <div className="hmeta">
          <span className="hmeta-item">no login</span>
          <span className="hmeta-item hmeta-item--free">free</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-main">
          <div className="hero-kicker">Profile roaster · 00</div>
          <h1 className="hero-title">
            Get
            <br />
            roasted
          </h1>
          <div className="hero-rule" />
          <p className="hero-copy">
            Drop a link or a PDF. The machine reads it, finds the gap between how you look and
            what you shipped, and says it out loud in the voice you pick. Then it tells you how
            to fix it.
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-side-header">What it reads</div>
          <div className="hero-side-row">
            <span className="hero-side-row-label">github</span>
            <span className="hero-side-row-value">
              <span className="hero-side-row-kind">link</span> · repos · graph · bio
            </span>
          </div>
          {instagramEnabled && (
            <div className="hero-side-row">
              <span className="hero-side-row-label">instagram</span>
              <span className="hero-side-row-value">
                <span className="hero-side-row-kind">link</span> · captions · grid
              </span>
            </div>
          )}
          <div className="hero-side-row">
            <span className="hero-side-row-label">linkedin</span>
            <span className="hero-side-row-value">
              <span className="hero-side-row-kind">pdf</span> · headline · roles
            </span>
          </div>
          <div className="hero-side-row">
            <span className="hero-side-row-label">resume</span>
            <span className="hero-side-row-value">
              <span className="hero-side-row-kind">pdf</span> · or pasted text
            </span>
          </div>
          <div className="hero-side-footer">
            Output: one roast, five to seven fixes you can actually do this week.
          </div>
        </div>
      </section>

      <section className="steps">
        <div className="step">
          <div className="step-index">01</div>
          <div className="step-copy">Pick a source — paste a link or drop a PDF.</div>
        </div>
        <div className="step">
          <div className="step-index">02</div>
          <div className="step-copy">Choose a voice, and how much it should hurt.</div>
        </div>
        <div className="step">
          <div className="step-index">03</div>
          <div className="step-copy">Watch it print, then tick off the fixes.</div>
        </div>
      </section>

      <InputForm
        key={resetKey}
        url={url}
        onUrlChange={setUrl}
        type={type}
        onTypeChange={handleTypeChange}
        severity={severity}
        onSeverityChange={setSeverity}
        persona={persona}
        onPersonaChange={setPersona}
        model={model}
        onModelChange={setModel}
        onSubmit={handleSubmit}
        loading={loading}
        instagramEnabled={instagramEnabled}
      />

      <section className="submit-section">
        <button type="button" className={`submit${loading ? " is-streaming" : ""}`} disabled={disabled} onClick={handleSubmit}>
          <span>{loading ? "roasting" : "roast this profile"}</span>
          <span className="submit-arrow">&#8594;</span>
        </button>
        {loading && (
          <div className="progress-track">
            <div className="progress-bar" />
          </div>
        )}
        <div className="rate">
          <span className="rate-label">
            Rate limit ·{" "}
            <span className="rate-label-value">
              {rateLimitStatus?.unlimited
                ? "bypassed (dev)"
                : `${rateLimit.remaining}/${rateLimit.limit} roasts left this hour`}
            </span>
          </span>
          {!rateLimitStatus?.unlimited && (
            <span className="rate-ticks">
              {Array.from({ length: rateLimit.limit }, (_, i) => (
                <span key={i} className={`rate-tick${i < rateLimit.remaining ? " is-filled" : ""}`} />
              ))}
            </span>
          )}
        </div>
      </section>

      <div ref={outputRef}>
        <RoastCard
          status={status}
          roast={result?.roast ?? ""}
          tips={result?.tips ?? []}
          error={error}
          type={type}
          severity={severity}
          personaName={personaName(persona)}
          modelUsed={result?.modelUsed}
          onRetry={handleSubmit}
          onRoastAnother={handleRoastAnother}
        />
      </div>

      <footer className="footer">
        <div className="footer-name">Made by Sarthak Mohite</div>
        <div className="footer-spacer" />
        <div className="footer-brand">
          <span className="footer-brand-mark" />
          <span className="footer-brand-name">Roastify</span>
        </div>
      </footer>
    </div>
  );
}
