import { resolvePersona } from "./personas.js";
import { CHAT_BASE_FRAGMENT, UNTRUSTED_DATA_NOTICE } from "./fragments.js";
import { fenceUntrustedContent } from "./fence.js";

// Composes the system prompt for a chat conversation about an existing roast — a
// deliberately separate composer from getSystemPrompt() (./index.js), not an extra
// branch on it: chat has no output contract (BASE_FRAGMENT's "return ONLY JSON" doesn't
// apply), no profile type, and no severity dial, only a locked persona voice and the
// roast text/tips already produced. Persona and the untrusted-data notice are the same
// fragments getSystemPrompt() uses, reused rather than duplicated.
//
// The roast is model output derived from attacker-controlled scraped/pasted input, so it
// gets the same fenceUntrustedContent() treatment scraped profile data gets before ever
// reaching the model — never dropped into the prompt raw.
export function getChatSystemPrompt(personaId, roast, tips) {
  const persona = resolvePersona(personaId);
  const tipsList = (Array.isArray(tips) ? tips : []).map((tip) => `- ${tip}`).join("\n");
  const roastContext = fenceUntrustedContent(`ROAST:\n${roast}\n\nTIPS GIVEN:\n${tipsList}`);

  return [
    CHAT_BASE_FRAGMENT,
    persona.promptFragment,
    `THE ROAST YOU ALREADY GAVE THIS PERSON:\n${roastContext}`,
    UNTRUSTED_DATA_NOTICE,
  ].join("\n\n");
}
