import { useRef, useState } from "react";
import html2canvas from "html2canvas";

export default function RoastCard({ roast, tips, modelUsed, personaName }) {
  const [checked, setChecked] = useState([]);
  const [hoveredTip, setHoveredTip] = useState(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const cardRef = useRef();

  function toggle(i) {
    setChecked((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
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
        // this file (kept in sync with --color-bg-surface in src/index.css).
        backgroundColor: "#0e0e0e",
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

  return (
    <div className="w-full flex flex-col gap-8 animate-fade-in">
      <div ref={cardRef} className="w-full flex flex-col gap-8">
        <div
          className="relative border p-6"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-surface)",
            borderRadius: "2px",
          }}
        >
          <div
            className="mb-5 inline-flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{
              color: "var(--color-text-secondary)",
              fontFamily: "'Courier New', monospace",
            }}
          >
            <span
              className="inline-block h-3 w-3"
              style={{ backgroundColor: "var(--color-accent)", borderRadius: "2px" }}
            />
            roast output
            {personaName && <span style={{ color: "var(--color-text-muted)" }}>· {personaName}</span>}
            {import.meta.env.DEV && modelUsed && <span style={{ color: "var(--color-text-muted)" }}>· {modelUsed}</span>}
          </div>
          <div
            className="border-l-2 pl-4"
            style={{ borderLeftColor: "var(--color-accent)" }}
          >
            <p
              className="text-base sm:text-lg leading-8"
              style={{
                color: "var(--color-text-primary)",
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
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg-surface)",
            borderRadius: "2px",
          }}
        >
          <h3
            className="text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-text-secondary)", fontFamily: "'Courier New', monospace" }}
          >
            Survival Tips
          </h3>
          {tips.map((tip, i) => (
            <label
              key={i}
              className="flex items-start gap-4 cursor-pointer group py-1"
            >
              <span className="relative mt-0.5 shrink-0 w-4 h-4">
                <input
                  type="checkbox"
                  checked={checked.includes(i)}
                  onChange={() => toggle(i)}
                  onMouseEnter={() => setHoveredTip(i)}
                  onMouseLeave={() => setHoveredTip((prev) => (prev === i ? null : prev))}
                  className="absolute inset-0 w-4 h-4 cursor-pointer opacity-0"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none flex w-4 h-4 items-center justify-center border transition-colors duration-150"
                  style={{
                    backgroundColor: checked.includes(i) ? "var(--color-accent)" : "transparent",
                    borderColor: checked.includes(i) || hoveredTip === i ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderRadius: "2px",
                  }}
                >
                  {checked.includes(i) && (
                    <svg
                      className="w-2.5 h-2.5"
                      fill="none"
                      viewBox="0 0 12 12"
                      style={{ color: "var(--color-bg-primary)" }}
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
              </span>
              <span
                className="text-sm leading-7 transition-colors duration-150"
                style={{
                  color: checked.includes(i) ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                  textDecoration: checked.includes(i) ? "line-through" : "none",
                  fontFamily: "'Courier New', monospace",
                }}
              >
                {tip}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="w-full grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={handleShare}
          className="w-full border px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] transition-colors duration-200"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "transparent",
            color: copied ? "var(--color-accent)" : "var(--color-text-secondary)",
            borderRadius: "2px",
            fontFamily: "'Courier New', monospace",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-accent)";
            e.currentTarget.style.color = "var(--color-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.color = copied ? "var(--color-accent)" : "var(--color-text-secondary)";
          }}
        >
          {copied ? "copied." : "share roast"}
        </button>

        <button
          type="button"
          onClick={handleSaveAsImage}
          disabled={generating}
          className="w-full border px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] transition-colors duration-200"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "transparent",
            color: generating ? "var(--color-accent)" : "var(--color-text-secondary)",
            borderRadius: "2px",
            fontFamily: "'Courier New', monospace",
            opacity: generating ? 0.8 : 1,
            cursor: generating ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => {
            if (!generating) {
              e.currentTarget.style.borderColor = "var(--color-accent)";
              e.currentTarget.style.color = "var(--color-accent)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--color-border)";
            e.currentTarget.style.color = generating ? "var(--color-accent)" : "var(--color-text-secondary)";
          }}
        >
          {generating ? "generating..." : "save as image"}
        </button>
      </div>
    </div>
  );
}
