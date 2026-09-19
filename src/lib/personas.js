// Frontend mirror of the persona registry in api/_lib/prompts/personas.js — kept in
// sync manually rather than cross-imported across the frontend/backend boundary,
// matching how InputForm.jsx's `models` array already mirrors MODEL_OPTIONS in
// api/roast.js instead of importing it directly.
// `icon`/`tagline`/`verdictBadge` are decorative-only display copy for
// src/routes/Roaster.jsx's persona picker and verdict card. `quickRetorts` backs
// src/routes/ChatThread.jsx's "quick counter-argument injector" chips — a real, sent
// message (via the existing send-message flow), just persona-appropriate canned text
// rather than one generic set for all three. None of these play any part in persona
// resolution and none have a backend counterpart.
export const PERSONAS = [
  {
    value: "cynic",
    name: "The Cynic",
    icon: "⚡",
    tagline: "Debugged production at 3am too many times to be nice about your code anymore. Hype-allergic. Buzzword-immune.",
    verdictBadge: "The Cynic Executioner Verdict",
    quickRetorts: [
      "what's the one thing to fix first",
      "is it really that bad",
      "give me a rewrite of my bio",
    ],
  },
  {
    value: "recruiter",
    name: "The Recruiter",
    icon: "💼",
    tagline: "Skims resumes for a living, judges yours for fun. If your title says 'Ninja,' she's already closed the tab.",
    verdictBadge: "The Recruiter Gatekeeper Verdict",
    quickRetorts: [
      "what would actually get this past the ATS",
      "rewrite my headline so it doesn't get skimmed",
      "what's the one line that's sinking this resume",
    ],
  },
  {
    value: "desi-uncle",
    name: "The Desi Uncle",
    icon: "👀",
    tagline: "Knows your salary before you've told anyone. Will find a way to compare you to Sharma ji's son within one paragraph.",
    verdictBadge: "The Desi Uncle Tribunal Verdict",
    quickRetorts: [
      "beta, what would even impress you",
      "compare me to Sharma ji's son again but nicer this time",
      "fine, what should I actually fix",
    ],
  },
];

export const DEFAULT_PERSONA = "cynic";

export function personaName(personaValue) {
  return PERSONAS.find((p) => p.value === personaValue)?.name ?? null;
}
