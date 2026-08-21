import { useEffect, useState } from "react";
import InputForm from "./components/InputForm";
import RoastCard from "./components/RoastCard";
import { getRoast, getRateLimitStatus } from "./lib/openai";
import { DEFAULT_PERSONA, personaName } from "./lib/personas";

// linkedin no longer scrapes server-side at all (PDF upload instead, see api/roast.js) —
// only instagram still goes through a slow Apify poll.
const SLOW_SCRAPE_TYPES = new Set(["instagram"]);
const SLOW_NOTICE_DELAY_MS = 5000;

function formatCountdown(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
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
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    getRateLimitStatus().then(setRateLimitStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading || !SLOW_SCRAPE_TYPES.has(type)) {
      return undefined;
    }

    const timer = setTimeout(() => setShowSlowNotice(true), SLOW_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, type]);

  useEffect(() => {
    if (!rateLimitStatus || rateLimitStatus.remaining > 0 || !rateLimitStatus.reset) {
      return undefined;
    }

    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [rateLimitStatus]);

  async function handleSubmit() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setErrorRetryable(false);
    setResult(null);
    setShowSlowNotice(false);
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
      if (data.rateLimit) setRateLimitStatus(data.rateLimit);
    } catch (err) {
      // No canned roast on failure anymore (see api/roast.js) — show the real message,
      // and clear any partial roast text a mid-stream failure may have already rendered
      // so it doesn't linger next to the error.
      setResult(null);
      setError(err.message ?? "Something went wrong.");
      setErrorRetryable(Boolean(err.retryable));
      if (err.rateLimit) setRateLimitStatus(err.rateLimit);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-20"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      <div className="w-full max-w-3xl mb-14 flex flex-col items-start gap-3">
        <div
          className="pl-4"
          style={{
            borderLeft: "2px solid var(--color-accent)",
          }}
        >
          <h1
            className="text-5xl font-black tracking-[-0.08em] uppercase leading-none"
            style={{ color: "var(--color-accent)" }}
          >
            Roastify
          </h1>
          <div
            className="mt-3 h-px w-24"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
        </div>
        <p
          className="text-sm sm:text-base tracking-[0.02em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Paste a profile URL and let the machine do the judging.
        </p>
      </div>

      <div className="w-full max-w-3xl flex flex-col gap-10">
        <InputForm
          url={url}
          onUrlChange={setUrl}
          type={type}
          onTypeChange={setType}
          severity={severity}
          onSeverityChange={setSeverity}
          persona={persona}
          onPersonaChange={setPersona}
          model={model}
          onModelChange={setModel}
          onSubmit={handleSubmit}
          loading={loading}
        />

        {rateLimitStatus && (
          <p
            className="text-center text-[10px] uppercase tracking-[0.18em]"
            style={{ color: rateLimitStatus.remaining === 0 ? "var(--color-accent)" : "var(--color-text-secondary)" }}
          >
            {rateLimitStatus.unlimited
              ? "rate limit bypassed (dev)"
              : rateLimitStatus.remaining > 0
              ? `${rateLimitStatus.remaining}/${rateLimitStatus.limit} roasts left this hour`
              : rateLimitStatus.reset
              ? `rate limit reached — resets in ${formatCountdown(rateLimitStatus.reset - now)}`
              : "rate limit reached — try again later"}
          </p>
        )}

        {showSlowNotice && (
          <p
            className="text-center text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            still scraping the profile, this can take up to ~30s — hang tight
          </p>
        )}

        {error && (
          <div
            className="border p-4 text-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            style={{
              borderColor: "var(--color-accent)",
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-accent)",
              borderRadius: "2px",
            }}
          >
            <span>{error}</span>
            {errorRetryable && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="shrink-0 border px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] transition-colors duration-200"
                style={{
                  borderColor: "var(--color-accent)",
                  backgroundColor: "transparent",
                  color: "var(--color-accent)",
                  borderRadius: "2px",
                  fontFamily: "'Courier New', monospace",
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                try again
              </button>
            )}
          </div>
        )}

        {result && (
          <RoastCard
            roast={result.roast}
            tips={result.tips}
            modelUsed={result.modelUsed}
            personaName={personaName(result.persona)}
          />
        )}
      </div>

      <footer
        className="mt-24 text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        developed by Sarthak Mohite · powered by Groq
      </footer>
    </div>
  );
}
