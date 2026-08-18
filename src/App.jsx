import { useEffect, useState } from "react";
import InputForm from "./components/InputForm";
import RoastCard from "./components/RoastCard";
import { getRoast, getRateLimitStatus } from "./lib/openai";

const SLOW_SCRAPE_TYPES = new Set(["linkedin", "instagram"]);
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
  const [model, setModel] = useState("gpt-4o");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
    setResult(null);
    setShowSlowNotice(false);
    try {
      const data = await getRoast(url, type, severity, model, {
        onRoastChunk: (text) => setResult((prev) => ({ ...prev, roast: text, tips: prev?.tips || [] })),
      });
      setResult(data);
      if (data.rateLimit) setRateLimitStatus(data.rateLimit);
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
      if (err.rateLimit) setRateLimitStatus(err.rateLimit);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center px-4 py-20"
      style={{ backgroundColor: "#000000" }}
    >
      <div className="w-full max-w-3xl mb-14 flex flex-col items-start gap-3">
        <div
          className="pl-4"
          style={{
            borderLeft: "2px solid #e2b714",
          }}
        >
          <h1
            className="text-5xl font-black tracking-[-0.08em] uppercase leading-none"
            style={{ color: "#e2b714" }}
          >
            Roastify
          </h1>
          <div
            className="mt-3 h-px w-24"
            style={{ backgroundColor: "#e2b714" }}
          />
        </div>
        <p
          className="text-sm sm:text-base tracking-[0.02em]"
          style={{ color: "#646669" }}
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
          model={model}
          onModelChange={setModel}
          onSubmit={handleSubmit}
          loading={loading}
        />

        {rateLimitStatus && (
          <p
            className="text-center text-[10px] uppercase tracking-[0.18em]"
            style={{ color: rateLimitStatus.remaining === 0 ? "#e2b714" : "#646669" }}
          >
            {rateLimitStatus.remaining > 0
              ? `${rateLimitStatus.remaining}/${rateLimitStatus.limit} roasts left this hour`
              : rateLimitStatus.reset
              ? `rate limit reached — resets in ${formatCountdown(rateLimitStatus.reset - now)}`
              : "rate limit reached — try again later"}
          </p>
        )}

        {showSlowNotice && (
          <p
            className="text-center text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "#646669" }}
          >
            still scraping the profile, this can take up to ~30s — hang tight
          </p>
        )}

        {error && (
          <div
            className="border p-4 text-sm"
            style={{
              borderColor: "#e2b714",
              backgroundColor: "#0d0d0d",
              color: "#e2b714",
              borderRadius: "2px",
            }}
          >
            {error}
          </div>
        )}

        {result && <RoastCard roast={result.roast} tips={result.tips} modelUsed={result.modelUsed} />}
      </div>

      <footer
        className="mt-24 text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "#646669" }}
      >
        developed by Kavyaansh Kundu, Fravash Dhruv & Sarthak Mohite · powered by GPT-4o / Cohere Command
      </footer>
    </div>
  );
}
