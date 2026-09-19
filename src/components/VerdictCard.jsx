import { forwardRef } from "react";
import { PERSONAS } from "../lib/personas";

// Only github/instagram's `identifier` is a real, displayable handle/URL — strip it down
// to the bare username (no protocol, no "github.com/"), never the full pasted URL.
// linkedin/resume have no handle to show, so it's a plain, honest label derived from
// `type` instead, never fabricated. Shared by RoastCard.jsx (a fresh roast) and
// History.jsx (a past one, exported as an image) — both need the exact same target echo.
function targetEcho(type, identifier) {
  const handle = identifier
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^(github|instagram)\.com\//i, "")
    .replace(/\/+$/, "");
  return handle || (type === "linkedin" ? "LinkedIn PDF" : type === "resume" ? "Resume" : "target_undefined");
}

// The shareable "verdict card" visual — head (Verdict/Target) + quote-card + meta-line +
// fixes — pulled out of RoastCard.jsx so History.jsx's own export card can render an
// identical-looking card from a past roast's stored data, rather than maintaining a
// second, chip-styled visual language just for that one export. `checked`/`onToggle`
// are optional: RoastCard.jsx passes both for its live, interactive checklist; a card
// built from history has no checked state worth restoring, so omitting them renders
// every tip as a plain, unchecked row instead.
const VerdictCard = forwardRef(function VerdictCard(
  { identifier, type, severity, persona, roast, tips, checked, onToggle, modelUsed, children },
  ref
) {
  const personaObj = PERSONAS.find((p) => p.value === persona) ?? PERSONAS[0];
  const interactive = Boolean(onToggle);

  return (
    <div className="rs-verdict" ref={ref}>
      <div className="rs-verdict-head">
        <span className="rs-verdict-id">
          <span className="rs-verdict-dot" />
          Verdict
        </span>
        <span className="rs-verdict-target">
          <span className="rs-verdict-target-label">Target:</span>
          <span className="rs-verdict-target-value">{targetEcho(type, identifier)}</span>
        </span>
      </div>
      <div className="rs-verdict-body">
        <div className="rs-quote-card">
          <span className="rs-quote-badge">{personaObj.verdictBadge}</span>
          <blockquote className="rs-quote-text">&#8220;{roast}&#8221;</blockquote>
        </div>

        <div className="rs-meta-line">
          {type} &middot; {severity}
          {import.meta.env.DEV && modelUsed ? ` · ${modelUsed}` : ""}
        </div>

        {tips?.length > 0 && (
          <div className="rs-fixes">
            <div className="rs-fixes-head">
              <span>Fixes</span>
              {interactive && (
                <span>
                  {checked.length}/{tips.length}
                </span>
              )}
            </div>
            <div className="rs-fixes-list">
              {tips.map((tip, i) => {
                const isChecked = interactive && checked.includes(i);
                return (
                  <label key={i} className={`rs-fix-row${isChecked ? " is-checked" : ""}`}>
                    <span className="rs-fix-checkbox">
                      {interactive && (
                        <input
                          type="checkbox"
                          className="rs-fix-checkbox-input"
                          checked={isChecked}
                          onChange={() => onToggle(i)}
                        />
                      )}
                      {isChecked && "✓"}
                    </span>
                    <span className="rs-fix-text">{tip}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
});

export default VerdictCard;
