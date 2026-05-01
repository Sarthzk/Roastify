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
          onSubmit={handleSubmit}
          loading={loading}
        />

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

        {result && <RoastCard roast={result.roast} tips={result.tips} />}
      </div>

      <footer
        className="mt-24 text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "#646669" }}
      >
        built in one night · powered by gpt-4o · frontend + backend
      </footer>
    </div>
  );
}
