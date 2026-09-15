import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import InputForm from "../components/InputForm";
import RoastCard from "../components/RoastCard";
import { getRoast, getRateLimitStatus } from "../lib/openai";
import { DEFAULT_PERSONA, personaName } from "../lib/personas";

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
// content); everything else falls back to a plain machine code. `code` travels through
// too — RoastCard needs it to tell SIGN_IN_REQUIRED (an invitation, not a failure) apart
// from every other error.
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
  return { code: err.code, message: err.message, detail, retryable: Boolean(err.retryable) };
}

export default function Roaster() {
  const { session, signIn, openSignIn } = useOutletContext();

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

  const status = loading ? "streaming" : error ? "error" : result ? "complete" : "idle";
  const instagramEnabled = rateLimitStatus?.instagramEnabled ?? true;
  const signedIn = Boolean(session);
  const instagramOpen = instagramEnabled && signedIn;
  const rateLimit = { limit: rateLimitStatus?.limit ?? 3, remaining: rateLimitStatus?.remaining ?? 3 };
  const disabled = !url.trim() || loading;

  // Refetches on every session change (sign-in, sign-out, initial resolution) — the
  // caller's tier (and so their limit/remaining) depends on it.
  useEffect(() => {
    getRateLimitStatus(session?.access_token).then(setRateLimitStatus).catch(() => {});
  }, [session]);

  // If Instagram becomes unavailable mid-session — the kill switch flips underneath a
  // user who already had it selected, or a signed-in user signs out — fall back to a
  // source that's still available.
  useEffect(() => {
    if (!instagramOpen && type === "instagram") {
      setType("github");
      setUrl("");
    }
  }, [instagramOpen, type]);

  // Scrolls the Output section to the top of the viewport. window.scrollTo clamps its
  // target to the page's scrollable height *at the moment it's called* — it doesn't
  // keep advancing on its own as streamed content grows the page taller afterward. So
  // the immediate on-click call below (for instant feedback) can land short of the
  // Output section on a page that's still short (idle state); the effect below it fires
  // again once the request reaches a terminal state, by which point the page has grown
  // to its real final height, correcting for whatever the first call undershot.
  function scrollToOutput() {
    const outputTop = outputRef.current?.getBoundingClientRect().top;
    if (outputTop !== undefined) {
      window.scrollTo({ top: window.scrollY + outputTop, behavior: "smooth" });
    }
  }

  useEffect(() => {
    if (status === "complete" || status === "error") {
      scrollToOutput();
    }
  }, [status]);

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
    scrollToOutput();
    try {
      // Production users can't select a model (the picker only renders in dev — see
      // InputForm.jsx) — don't send a `model` field at all outside dev, so there's
      // nothing for a modified client to spoof. The server pins production regardless
      // (resolveProductionSafeModelOption in api/roast.js is the real security boundary).
      // Persona, unlike model, is a real production feature and always sent — the
      // server validates it via resolvePersona regardless (api/_lib/prompts/personas.js).
      const data = await getRoast(url, type, severity, import.meta.env.DEV ? model : undefined, persona, {
        onRoastChunk: (text) => setResult((prev) => ({ ...prev, roast: text, tips: prev?.tips || [] })),
        accessToken: session?.access_token,
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
    <div>
      <section className="hero">
        <div className="hero-main">
          <h1 className="hero-title">
            Get
            <br />
            roasted
          </h1>
          <div className="hero-rule" />
          <p className="hero-copy">
            Drop a link or a PDF. The machine reads it, says out loud what your profile is
            actually telling people, then tells you how to fix it.
          </p>
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
        signedIn={signedIn}
        onSignIn={signIn}
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
            {rateLimitStatus?.unlimited ? (
              "rate limit · bypassed (dev)"
            ) : (
              <>
                <span className="rate-label-value">{rateLimit.remaining}</span> of {rateLimit.limit} roasts left today
              </>
            )}
          </span>
          {!rateLimitStatus?.unlimited &&
            (signedIn ? (
              <span className="rate-saved">saved to your history</span>
            ) : (
              <button type="button" className="rate-upgrade" onClick={openSignIn}>
                sign in for 15 a day<span>&#8594;</span>
              </button>
            ))}
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
          signedIn={signedIn}
          onRetry={handleSubmit}
          onRoastAnother={handleRoastAnother}
          onSignIn={signIn}
        />
      </div>
    </div>
  );
}
