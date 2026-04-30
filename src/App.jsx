import { useState } from "react";
import InputForm from "./components/InputForm";
import RoastCard from "./components/RoastCard";
import { getRoast } from "./lib/openai";

export default function App() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("github");
  const [result, setResult] = useState(null); // { roast, tips }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await getRoast(url, type);
      setResult(data);
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center px-4 py-16">
      {/* Header */}
      <div className="mb-12 text-center">
        <h1 className="text-6xl font-black tracking-tight text-orange-500 drop-shadow-[0_0_40px_rgba(249,115,22,0.4)]">
          Roastify
        </h1>
        <p className="mt-3 text-zinc-400 text-lg">
          Paste a profile URL. Brace for impact.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <InputForm
          url={url}
          onUrlChange={setUrl}
          type={type}
          onTypeChange={setType}
          onSubmit={handleSubmit}
          loading={loading}
        />

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-red-500/50 bg-red-950/40 p-4 text-red-400 text-sm">
            ⚠ {error}
          </div>
        )}

        {/* Result */}
        {result && <RoastCard roast={result.roast} tips={result.tips} />}
      </div>

      <footer className="mt-24 text-zinc-700 text-xs">
        built in one night · powered by gpt-4o · frontend + backend
      </footer>
    </div>
  );
}