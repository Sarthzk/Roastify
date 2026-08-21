import { describe, it, expect } from "vitest";
import { PERSONAS, DEFAULT_PERSONA_ID, resolvePersona, isPersonaAllowedForType } from "./personas.js";

describe("resolvePersona", () => {
  it("resolves each known persona id to its registered entry", () => {
    expect(resolvePersona("cynic")).toEqual(PERSONAS.cynic);
    expect(resolvePersona("recruiter")).toEqual(PERSONAS.recruiter);
    expect(resolvePersona("desi-uncle")).toEqual(PERSONAS["desi-uncle"]);
  });

  it("falls back to the default persona for an unknown id", () => {
    expect(resolvePersona("edgelord")).toEqual(PERSONAS[DEFAULT_PERSONA_ID]);
  });

  it("falls back to the default persona when no id is given", () => {
    expect(resolvePersona(undefined)).toEqual(PERSONAS[DEFAULT_PERSONA_ID]);
    expect(resolvePersona(null)).toEqual(PERSONAS[DEFAULT_PERSONA_ID]);
    expect(resolvePersona("")).toEqual(PERSONAS[DEFAULT_PERSONA_ID]);
  });

  it("defaults to cynic specifically — the existing pre-persona voice", () => {
    expect(DEFAULT_PERSONA_ID).toBe("cynic");
    expect(resolvePersona(undefined).id).toBe("cynic");
  });

  it("every registered persona has the shape { id, name, tagline, promptFragment, allowedTypes }", () => {
    for (const persona of Object.values(PERSONAS)) {
      expect(persona).toHaveProperty("id");
      expect(persona).toHaveProperty("name");
      expect(persona).toHaveProperty("tagline");
      expect(typeof persona.promptFragment).toBe("string");
      expect(persona.promptFragment.length).toBeGreaterThan(0);
      expect(Array.isArray(persona.allowedTypes)).toBe(true);
      expect(persona.allowedTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("isPersonaAllowedForType", () => {
  it("returns true for every real persona against every current profile type", () => {
    const types = ["github", "linkedin", "instagram", "resume"];
    for (const persona of Object.values(PERSONAS)) {
      for (const type of types) {
        expect(isPersonaAllowedForType(persona, type)).toBe(true);
      }
    }
  });

  it("enforces allowedTypes correctly for a restricted persona (future-proofing check)", () => {
    // No shipped persona is actually restricted yet — all 3 allow all 4 types — but the
    // handler's enforcement (api/roast.js) calls this exact function, so it needs to be
    // correct today for whenever a restricted persona (e.g. a debate-mode voice not
    // valid for straight profile roasts) is added later.
    const debateOnlyPersona = { id: "debate", allowedTypes: ["resume"] };
    expect(isPersonaAllowedForType(debateOnlyPersona, "resume")).toBe(true);
    expect(isPersonaAllowedForType(debateOnlyPersona, "github")).toBe(false);
    expect(isPersonaAllowedForType(debateOnlyPersona, "linkedin")).toBe(false);
    expect(isPersonaAllowedForType(debateOnlyPersona, "instagram")).toBe(false);
  });

  it("returns false for an empty allowedTypes list", () => {
    expect(isPersonaAllowedForType({ allowedTypes: [] }, "github")).toBe(false);
  });
});
