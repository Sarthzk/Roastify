import { useState } from "react";
import InputForm from "./components/InputForm";
import RoastCard from "./components/RoastCard";
import { getRoast } from "./lib/openai";

export default function App() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("github");
  const [result, setResult] = useState(null);
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
    <div
      className="min-h-screen flex flex-col items-center px-4 py-16"
      style={{ backgroundColor: "#000000" }}
    >
      <div className="mb-12 text-center">
        <h1
          className="text-6xl font-black tracking-tight drop-shadow-lg"
          style={{ color: "#e2b714" }}
        >
          Roastify
        </h1>
        <p className="mt-3 text-lg" style={{ color: "#646669" }}>
          Paste a profile URL. Brace for impact.
        </p>
      </div>

      <div className="w-full max-w-2xl flex flex-col gap-8">
        <InputForm
          url={url}
          onUrlChange={setUrl}
          type={type}
          onTypeChange={setType}
          onSubmit={handleSubmit}
          loading={loading}
        />

        {error && (
          <div
            className="rounded-2xl border-2 p-4 text-sm"
            style={{
              borderColor: "#e2b714",
              backgroundColor: "#0d0d0d",
              color: "#e2b714",
            }}
          >
            ⚠ {error}
          </div>
        )}

        {result && <RoastCard roast={result.roast} tips={result.tips} />}
      </div>

      <footer className="mt-24 text-xs" style={{ color: "#646669" }}>
        built in one night · powered by gpt-4o · frontend + backend
      </footer>
    </div>
  );
}
