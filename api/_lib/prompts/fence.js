import { randomBytes } from "node:crypto";

// Wraps untrusted profile/resume text in a fence the model is instructed (via
// UNTRUSTED_DATA_NOTICE in ./fragments.js) to treat as inert data, never instructions.
// The marker is a fresh random hex string generated *after* scraping, so attacker-
// controlled content can never legitimately contain today's exact closing fence — it
// doesn't exist yet at the time the bio/resume was written. FENCE_MARKER_PATTERN
// additionally strips any fence-*shaped* substring already present in the content
// (defense in depth against someone guessing the format and trying to fake a boundary,
// or a freak hash collision).
//
// Call this AFTER truncating to MAX_INPUT_LENGTH — never before, or the closing fence
// itself could get cut off by the truncation.
const FENCE_MARKER_PATTERN = /<<<\/?(?:END_)?PROFILE_DATA(?:_[0-9a-f]+)?>>>/gi;

export function fenceUntrustedContent(content) {
  const marker = randomBytes(8).toString("hex");
  const sanitized = String(content ?? "").replace(FENCE_MARKER_PATTERN, "[removed]");
  return `<<<PROFILE_DATA_${marker}>>>\n${sanitized}\n<<<END_PROFILE_DATA_${marker}>>>`;
}
