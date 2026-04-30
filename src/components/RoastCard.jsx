import { useState } from "react";

export default function RoastCard({ roast, tips }) {
  const [checked, setChecked] = useState([]);

  function toggle(i) {
    setChecked((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      <div
        className="relative rounded-2xl border-2 p-6"
        style={{
          borderColor: "#e2b714",
          backgroundColor: "#111111",
        }}
      >
        <span
          className="absolute -top-3 left-5 text-xs font-bold px-3 py-1 rounded-full tracking-widest uppercase"
          style={{
            backgroundColor: "#e2b714",
            color: "#000000",
            fontFamily: "'Courier New', monospace",
          }}
        >
          The Roast
        </span>
        <p className="text-lg leading-relaxed mt-2" style={{ color: "#d1d0c5", fontFamily: "'Courier New', monospace" }}>
          "{roast}"
        </p>
      </div>

      <div
        className="rounded-2xl border-2 p-6 flex flex-col gap-3"
        style={{
          borderColor: "#2c2e31",
          backgroundColor: "#0d0d0d",
        }}
      >
        <h3 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "#646669", fontFamily: "'Courier New', monospace" }}>
          Survival Tips
        </h3>
        {tips.map((tip, i) => (
          <label
            key={i}
            className="flex items-start gap-3 cursor-pointer group"
            onClick={() => toggle(i)}
          >
            <span
              className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors duration-150"
              style={{
                backgroundColor: checked.includes(i) ? "#e2b714" : "transparent",
                borderColor: checked.includes(i) ? "#e2b714" : "#646669",
              }}
              onMouseEnter={(e) => {
                if (!checked.includes(i)) {
                  e.target.style.borderColor = "#d1d0c5";
                }
              }}
              onMouseLeave={(e) => {
                if (!checked.includes(i)) {
                  e.target.style.borderColor = "#646669";
                }
              }}
            >
              {checked.includes(i) && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" style={{ color: "#000000" }}>
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span
              className="text-sm leading-relaxed transition-colors duration-150"
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
    </div>
  );
}
