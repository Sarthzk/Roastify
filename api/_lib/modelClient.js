import OpenAI from "openai";

// Extracted out of api/roast.js so api/messages.js (chat) can build the same Groq/OpenAI
// clients without duplicating the key-selection logic — both endpoints call the same
// model provider under the same production-pinned default (see
// resolveProductionSafeModelOption in api/roast.js). Nothing here changed behavior when
// it moved; it's the same two functions, same lazy-construction reasoning.
const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

export function getRequiredApiKey(provider) {
  return provider === "groq" ? groqApiKey : openaiApiKey;
}

// Constructed lazily (not at module load) so a missing key doesn't crash the whole
// process at import time — each handler's own key check handles it as a normal 500
// response instead, and this module stays importable in tests/CI without needing any
// real (or dummy) API keys set.
export function getClient(modelOption) {
  return modelOption.provider === "groq"
    ? new OpenAI({ apiKey: groqApiKey, baseURL: "https://api.groq.com/openai/v1", maxRetries: 2 })
    : new OpenAI({ apiKey: openaiApiKey, maxRetries: 2 });
}
