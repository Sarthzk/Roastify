import { describe, it, expect } from "vitest";
import { getChatSystemPrompt } from "./chat.js";
import { CHAT_BASE_FRAGMENT_WITH_PROFILE, CHAT_BASE_FRAGMENT_NO_PROFILE, UNTRUSTED_DATA_NOTICE } from "./fragments.js";
import { PERSONAS } from "./personas.js";

describe("getChatSystemPrompt — no profile data (linkedin/resume, or an expired roast)", () => {
  it("composes the no-profile base fragment, the persona's voice, and the untrusted-data notice", () => {
    const prompt = getChatSystemPrompt("cynic", "You are pathetic.", ["Fix your bio."]);

    expect(prompt).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
    expect(prompt).not.toContain(CHAT_BASE_FRAGMENT_WITH_PROFILE);
    expect(prompt).toContain(PERSONAS.cynic.promptFragment);
    expect(prompt).toContain(UNTRUSTED_DATA_NOTICE);
  });

  it("omitting profileData (undefined) and passing null both select the no-profile variant", () => {
    const withUndefined = getChatSystemPrompt("cynic", "roast", []);
    const withNull = getChatSystemPrompt("cynic", "roast", [], null);

    expect(withUndefined).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
    expect(withNull).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
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

  it("tells the model it has no profile/resume for this conversation", () => {
    expect(CHAT_BASE_FRAGMENT_NO_PROFILE).toContain("You do not have their profile or resume");
  });

  it("tells the model to reply in plain text, not the roast JSON contract", () => {
    expect(CHAT_BASE_FRAGMENT_NO_PROFILE).toContain("not JSON");
  });
});

describe("getChatSystemPrompt — profile data present (github/instagram, not yet expired)", () => {
  const profileData = "GitHub Profile: octocat\nBio: probably a cat\nTop 10 repositories:\n1. Hello-World";

  it("composes the with-profile base fragment instead of the no-profile one", () => {
    const prompt = getChatSystemPrompt("cynic", "You are pathetic.", ["Fix your bio."], profileData);

    expect(prompt).toContain(CHAT_BASE_FRAGMENT_WITH_PROFILE);
    expect(prompt).not.toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
  });

  it("embeds the profile data, fenced rather than dropped in raw", () => {
    const prompt = getChatSystemPrompt("cynic", "roast", [], profileData);

    expect(prompt).toContain("THEIR PROFILE DATA:");
    expect(prompt).toContain(profileData);
    // Two independent fenced blocks: one for the roast, one for the profile data.
    const fenceOpenings = prompt.match(/<<<PROFILE_DATA_[0-9a-f]+>>>/g) || [];
    expect(fenceOpenings.length).toBe(2);
  });

  it("never returns the profile data unfenced", () => {
    const marker = "Unique profile marker 98765.";
    const prompt = getChatSystemPrompt("cynic", "roast", [], marker);
    const fenceBlocks = prompt.match(/<<<PROFILE_DATA_([0-9a-f]+)>>>([\s\S]*?)<<<END_PROFILE_DATA_\1>>>/g) || [];

    expect(fenceBlocks.some((block) => block.includes(marker))).toBe(true);
    const outsideFences = fenceBlocks.reduce((text, block) => text.replace(block, ""), prompt);
    expect(outsideFences).not.toContain(marker);
  });

  it("an empty string profileData is treated the same as absent (no-profile variant)", () => {
    const prompt = getChatSystemPrompt("cynic", "roast", [], "");
    expect(prompt).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
  });

  it("still includes the untrusted-data notice", () => {
    const prompt = getChatSystemPrompt("cynic", "roast", [], profileData);
    expect(prompt).toContain(UNTRUSTED_DATA_NOTICE);
  });

  it("tells the model it can reference specifics from the profile data", () => {
    expect(CHAT_BASE_FRAGMENT_WITH_PROFILE).toContain("use real specifics from the profile data");
  });
});
