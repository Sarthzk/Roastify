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
      {/* Roast */}
      <div className="relative rounded-2xl border-2 border-orange-500/60 bg-zinc-900/90 p-6">
        <span className="absolute -top-3 left-5 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest uppercase">
          The Roast
        </span>
        <p className="text-zinc-100 text-lg leading-relaxed mt-2 font-serif italic">
          "{roast}"
        </p>
      </div>

      {/* Tips */}
      <div className="rounded-2xl border-2 border-zinc-700 bg-zinc-900/80 p-6 flex flex-col gap-3">
        <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">
          Survival Tips
        </h3>
        {tips.map((tip, i) => (
          <label
            key={i}
            className="flex items-start gap-3 cursor-pointer group"
            onClick={() => toggle(i)}
          >
            <span
              className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center
                          transition-colors duration-150
                          ${checked.includes(i)
                            ? "bg-orange-500 border-orange-500"
                            : "border-zinc-600 group-hover:border-orange-400"
                          }`}
            >
              {checked.includes(i) && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span
              className={`text-sm leading-relaxed transition-colors duration-150
                          ${checked.includes(i) ? "line-through text-zinc-600" : "text-zinc-300"}`}
            >
              {tip}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}