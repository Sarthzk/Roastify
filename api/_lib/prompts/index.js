import { BASE_FRAGMENT, TYPE_FRAGMENTS, SEVERITY_FRAGMENTS, UNTRUSTED_DATA_NOTICE } from "./fragments.js";
import { resolvePersona } from "./personas.js";

// Composes the system prompt from named fragments instead of maintaining N (type) x M
// (persona) near-duplicate template literals — see api/roast.js's old getSystemPrompt
// for what this replaced (4 templates differing by only a couple of lines each; adding
// 3 personas to that structure would have meant 12). Order here isn't correctness-
// sensitive, just readable: role/contract, then voice, then subject matter, then
// intensity, then the security notice last (most recent instruction in context).
export function getSystemPrompt(type, severity, personaId) {
  const persona = resolvePersona(personaId);
  const typeFragment = TYPE_FRAGMENTS[type] || TYPE_FRAGMENTS.github;
  const severityFragment = SEVERITY_FRAGMENTS[severity] || SEVERITY_FRAGMENTS.medium;

  return [BASE_FRAGMENT, persona.promptFragment, typeFragment, severityFragment, UNTRUSTED_DATA_NOTICE].join("\n\n");
}
