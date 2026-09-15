import { describe, it, expect } from "vitest";
import { getChatSystemPrompt } from "./chat.js";
import { CHAT_BASE_FRAGMENT, UNTRUSTED_DATA_NOTICE } from "./fragments.js";
import { PERSONAS } from "./personas.js";

describe("getChatSystemPrompt", () => {
  it("composes the chat base fragment, the persona's voice, and the untrusted-data notice", () => {
    const prompt = getChatSystemPrompt("cynic", "You are pathetic.", ["Fix your bio."]);

    expect(prompt).toContain(CHAT_BASE_FRAGMENT);
    expect(prompt).toContain(PERSONAS.cynic.promptFragment);
    expect(prompt).toContain(UNTRUSTED_DATA_NOTICE);
  });

  it("embeds the roast text and tips, fenced rather than dropped in raw", () => {
    const prompt = getChatSystemPrompt("cynic", "You are pathetic.", ["Fix your bio.", "Delete your account."]);

    expect(prompt).toMatch(/<<<PROFILE_DATA_[0-9a-f]+>>>/);
    expect(prompt).toMatch(/<<<END_PROFILE_DATA_[0-9a-f]+>>>/);
    expect(prompt).toContain("You are pathetic.");
    expect(prompt).toContain("Fix your bio.");
    expect(prompt).toContain("Delete your account.");
  });

  it("never returns the roast text unfenced", () => {
    const roast = "Unique roast text marker 12345.";
    const prompt = getChatSystemPrompt("cynic", roast, []);
    const fenceMatch = prompt.match(/<<<PROFILE_DATA_([0-9a-f]+)>>>([\s\S]*?)<<<END_PROFILE_DATA_\1>>>/);

    expect(fenceMatch).not.toBeNull();
    expect(fenceMatch[2]).toContain(roast);
  });

  it("falls back to the default persona for an unknown/missing persona id", () => {
    // fenceUntrustedContent's marker is fresh random hex per call (by design — see
    // fence.js), so two independently-built prompts never match byte-for-byte even with
    // identical inputs. Compare the persona voice fragment itself instead.
    expect(getChatSystemPrompt("not-a-real-persona", "roast", [])).toContain(PERSONAS.cynic.promptFragment);
    expect(getChatSystemPrompt(undefined, "roast", [])).toContain(PERSONAS.cynic.promptFragment);
  });

  it("different personas produce different prompts for the same roast", () => {
    const cynic = getChatSystemPrompt("cynic", "roast text", ["tip"]);
    const recruiter = getChatSystemPrompt("recruiter", "roast text", ["tip"]);
    const desiUncle = getChatSystemPrompt("desi-uncle", "roast text", ["tip"]);

    expect(cynic).not.toBe(recruiter);
    expect(cynic).not.toBe(desiUncle);
    expect(recruiter).not.toBe(desiUncle);
  });

  it("handles a missing/non-array tips list without throwing", () => {
    expect(() => getChatSystemPrompt("cynic", "roast", undefined)).not.toThrow();
    expect(() => getChatSystemPrompt("cynic", "roast", null)).not.toThrow();
  });

  it("tells the model it has no profile/resume, only the roast", () => {
    expect(CHAT_BASE_FRAGMENT).toContain("You do not have their GitHub/LinkedIn/Instagram profile or resume");
  });

  it("tells the model to reply in plain text, not the roast JSON contract", () => {
    expect(CHAT_BASE_FRAGMENT).toContain("not JSON");
  });
});
