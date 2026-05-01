import { useState } from "react";

export default function RoastCard({ roast, tips }) {
  const [checked, setChecked] = useState([]);
  const [copied, setCopied] = useState(false);

  function toggle(i) {
    setChecked((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }

  async function handleShare() {
    const shareText = `I got roasted by Roastify 🔥

${roast}

get roasted at roastify.vercel.app`;

    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="w-full flex flex-col gap-8 animate-fade-in">
      <div
        className="relative border p-6"
        style={{
          borderColor: "#2c2e31",
          backgroundColor: "#0e0e0e",
          borderRadius: "2px",
        }}
      >
        <div
          className="mb-5 inline-flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{
            color: "#646669",
            fontFamily: "'Courier New', monospace",
          }}
        >
          <span
            className="inline-block h-3 w-3"
            style={{ backgroundColor: "#e2b714", borderRadius: "2px" }}
          />
          roast output
        </div>
        <div
          className="border-l-2 pl-4"
          style={{ borderLeftColor: "#e2b714" }}
        >
          <p
            className="text-base sm:text-lg leading-8"
            style={{
              color: "#d1d0c5",
              fontFamily: "'Courier New', monospace",
            }}
          >
            {roast}
          </p>
        </div>
      </div>

      <div
        className="border p-6 flex flex-col gap-4"
        style={{
          borderColor: "#2c2e31",
          backgroundColor: "#0e0e0e",
          borderRadius: "2px",
        }}
      >
        <h3
          className="text-[10px] font-bold uppercase tracking-[0.2em]"
          style={{ color: "#646669", fontFamily: "'Courier New', monospace" }}
        >
          Survival Tips
        </h3>
        {tips.map((tip, i) => (
          <label
            key={i}
            className="flex items-start gap-4 cursor-pointer group py-1"
            onClick={() => toggle(i)}
          >
            <span
              className="mt-0.5 flex-shrink-0 w-4 h-4 border flex items-center justify-center transition-colors duration-150"
              style={{
                backgroundColor: checked.includes(i) ? "#e2b714" : "transparent",
                borderColor: checked.includes(i) ? "#e2b714" : "#646669",
                borderRadius: "2px",
              }}
              onMouseEnter={(e) => {
                if (!checked.includes(i)) {
                  e.currentTarget.style.borderColor = "#e2b714";
                }
              }}
              onMouseLeave={(e) => {
                if (!checked.includes(i)) {
                  e.currentTarget.style.borderColor = "#646669";
                }
              }}
            >
              {checked.includes(i) && (
                <svg
                  className="w-2.5 h-2.5"
                  fill="none"
                  viewBox="0 0 12 12"
                  style={{ color: "#000000" }}
                >
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            <span
              className="text-sm leading-7 transition-colors duration-150"
              style={{
                color: checked.includes(i) ? "#646669" : "#d1d0c5",
                textDecoration: checked.includes(i) ? "line-through" : "none",
                fontFamily: "'Courier New', monospace",
              }}
            >
              {tip}
            </span>
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={handleShare}
        className="w-full border px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] transition-colors duration-200"
        style={{
          borderColor: "#2c2e31",
          backgroundColor: "transparent",
          color: copied ? "#e2b714" : "#646669",
          borderRadius: "2px",
          fontFamily: "'Courier New', monospace",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#e2b714";
          e.currentTarget.style.color = "#e2b714";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "#2c2e31";
          e.currentTarget.style.color = copied ? "#e2b714" : "#646669";
        }}
      >
        {copied ? "copied." : "share roast"}
      </button>
    </div>
  );
}
