// Frontend mirror of the persona registry in api/_lib/prompts/personas.js — kept in
// sync manually rather than cross-imported across the frontend/backend boundary,
// matching how InputForm.jsx's `models` array already mirrors MODEL_OPTIONS in
// api/roast.js instead of importing it directly.
export const PERSONAS = [
  { value: "cynic", name: "The Cynic", tagline: "Dry, nihilistic, Gervais-flavored — the original voice." },
  { value: "recruiter", name: "The Recruiter", tagline: "Savage but professional — a hiring decision, not a joke." },
  { value: "desi-uncle", name: "The Desi Uncle", tagline: "Disappointed comparisons, heavy Hinglish, affectionate underneath." },
];

export const DEFAULT_PERSONA = "cynic";

export function personaName(personaValue) {
  return PERSONAS.find((p) => p.value === personaValue)?.name ?? null;
}
