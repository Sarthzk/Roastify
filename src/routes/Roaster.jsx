import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import InputForm from "../components/InputForm";
import RoastCard from "../components/RoastCard";
import { getRoast, getRateLimitStatus, getHistory, startConversation } from "../lib/openai";
import { DEFAULT_PERSONA } from "../lib/personas";
import { describeError } from "../lib/roasterErrors";

export default function Roaster() {
  const { session, signIn, updateQuota } = useOutletContext();
  const navigate = useNavigate();

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
  const [startingChat, setStartingChat] = useState(false);
  const [chatError, setChatError] = useState(null);
  const outputRef = useRef(null);

  const status = loading ? "streaming" : error ? "error" : result ? "complete" : "idle";
  const instagramEnabled = rateLimitStatus?.instagramEnabled ?? true;
  const signedIn = Boolean(session);
  const instagramOpen = instagramEnabled && signedIn;
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
    setChatError(null);
    setUrl("");
    // Remounts InputForm, clearing its local upload state (the file confirmation card,
    // upload status/error) for free — see CLAUDE.md's "Frontend structure" for why that
    // state stays local rather than living here.
    setResetKey((k) => k + 1);
  }

  // Entry point 1 into chat (the other is a history row — see History.jsx). The roast
  // stream's own `complete` event (api/roast.js) never included a persisted row id —
  // adding one there is out of scope for this task (the roast handler itself is off
  // limits) — so this leans on an invariant that already holds instead: persistRoast()
  // writes the row *before* that event ships, and nothing else can create a roast for
  // this signed-in caller between it landing and this click (the button only exists in
  // the completed-roast state, which can't be reached again without "roast another"
  // clearing it first). The newest row in the caller's own history is, in practice,
  // exactly this one.
  async function handleStartChat() {
    setStartingChat(true);
    setChatError(null);
    try {
      const history = await getHistory(session.access_token);
      const roastId = history.roasts[0]?.id;
      if (!roastId) throw new Error("Couldn't find that roast in your history yet — try again in a moment.");
      const conversation = await startConversation(session.access_token, roastId);
      navigate(`/chat/${conversation.id}`, { state: { fresh: true } });
    } catch (err) {
      setChatError(err.message);
      setStartingChat(false);
    }
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
      if (data.rateLimit) {
        setRateLimitStatus((prev) => ({ ...prev, ...data.rateLimit }));
        updateQuota(data.rateLimit);
      }
    } catch (err) {
      // No canned roast on failure anymore (see api/roast.js) — show the real message.
      setResult(null);
      setError(describeError(err, { type }));
      if (err.rateLimit) {
        setRateLimitStatus((prev) => ({ ...prev, ...err.rateLimit }));
        updateQuota(err.rateLimit);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="roaster-studio">
      <section className="rs-hero">
        <span className="rs-hero-badge">&#9889; AI Critique Studio</span>
        <h1 className="rs-hero-title">Get roasted</h1>
        <p className="rs-hero-copy">
          Feed us your GitHub, LinkedIn, Instagram, or resume. We strip the corporate
          buzzwords, inspect your real output, and deliver cold, constructive reality.
        </p>
      </section>

      {/* Desktop split: controls (Target Platform + Judgment Parameters + submit) on the
          left, the Verdict card sticky on the right — see .rs-grid in src/index.css.
          Pure layout wrapper; collapses to one column, controls first, below 1024px. No
          prop or state changes to either child. */}
      <div className="rs-grid">
        <div className="rs-col-controls">
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
            disabled={disabled}
            instagramEnabled={instagramEnabled}
            signedIn={signedIn}
            onSignIn={signIn}
          />
        </div>

        <div className="rs-col-verdict" ref={outputRef}>
          <RoastCard
            status={status}
            roast={result?.roast ?? ""}
            tips={result?.tips ?? []}
            error={error}
            type={type}
            // Only github/instagram's `url` is a real, displayable identifier (a handle
            // or profile URL) — linkedin/resume's `url` field holds pasted/PDF-extracted
            // body text, which would be a useless (and ugly) thing to show as a target
            // header, so it's deliberately withheld for those two.
            identifier={type === "github" || type === "instagram" ? url : null}
            severity={severity}
            persona={persona}
            modelUsed={result?.modelUsed}
            signedIn={signedIn}
            onRetry={handleSubmit}
            onRoastAnother={handleRoastAnother}
            onSignIn={signIn}
            onStartChat={handleStartChat}
            startingChat={startingChat}
            chatError={chatError}
          />
        </div>
      </div>
    </div>
  );
}
