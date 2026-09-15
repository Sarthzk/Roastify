import { resolvePersona } from "./personas.js";
import { CHAT_BASE_FRAGMENT_WITH_PROFILE, CHAT_BASE_FRAGMENT_NO_PROFILE, UNTRUSTED_DATA_NOTICE } from "./fragments.js";
import { fenceUntrustedContent } from "./fence.js";

// Composes the system prompt for a chat conversation about an existing roast — a
// deliberately separate composer from getSystemPrompt() (./index.js), not an extra
// branch on it: chat has no output contract (BASE_FRAGMENT's "return ONLY JSON" doesn't
// apply), no profile type, and no severity dial, only a locked persona voice, the roast
// text/tips already produced, and — for github/instagram, while it hasn't expired — the
// scraped profile data alongside it. profileData is already whatever api/messages.js
// decided to pass (null for linkedin/resume or an expired roast, already length-capped
// otherwise — see that file's own MAX_INPUT_LENGTH reuse) — this function doesn't
// re-derive either decision, same as getSystemPrompt() never truncates userMessageContent
// itself; that's the handler's job. Persona and the untrusted-data notice are the same
// fragments getSystemPrompt() uses, reused rather than duplicated.
//
// Both the roast and the profile data are model/scrape output derived from
// attacker-controlled input, so both get the same fenceUntrustedContent() treatment
// scraped profile data already gets in api/roast.js — never dropped into the prompt raw.
export function getChatSystemPrompt(personaId, roast, tips, profileData) {
  const persona = resolvePersona(personaId);
  const tipsList = (Array.isArray(tips) ? tips : []).map((tip) => `- ${tip}`).join("\n");
  const roastContext = fenceUntrustedContent(`ROAST:\n${roast}\n\nTIPS GIVEN:\n${tipsList}`);

  const sections = [
    profileData ? CHAT_BASE_FRAGMENT_WITH_PROFILE : CHAT_BASE_FRAGMENT_NO_PROFILE,
    persona.promptFragment,
    `THE ROAST YOU ALREADY GAVE THIS PERSON:\n${roastContext}`,
  ];

  if (profileData) {
    sections.push(`THEIR PROFILE DATA:\n${fenceUntrustedContent(profileData)}`);
  }

  sections.push(UNTRUSTED_DATA_NOTICE);
  return sections.join("\n\n");
}
