import OpenAI from "openai";
import { getClientIP, createRatelimit, getRateLimitKey } from "./_lib/rateLimit.js";
import { withScrapeCache } from "./_lib/scrapeCache.js";
import { handleCorsPreflight } from "./_lib/cors.js";
import { ERROR_CODES, RoastError, toErrorEnvelope } from "./_lib/errors.js";
import { getSystemPrompt } from "./_lib/prompts/index.js";
import { resolvePersona, isPersonaAllowedForType } from "./_lib/prompts/personas.js";
import { fenceUntrustedContent } from "./_lib/prompts/fence.js";
import { isInstagramEnabled } from "./_lib/config.js";
import { getAuthenticatedUser } from "./_lib/auth.js";
import { persistRoast } from "./_lib/persistRoast.js";
import { reportError } from "./_lib/sentry.js";
import { extractGithubUsername, scrapeGithub } from "./_lib/scrapers/github.js";
import { extractInstagramUsername, scrapeInstagram } from "./_lib/scrapers/instagram.js";
import { extractStreamingRoastText, sendSseEvent } from "./_lib/streaming.js";

// getSystemPrompt/PERSONAS stay reachable via api/roast.js specifically because
// scripts/eval-models.mjs imports them from here — everything else this handler uses
// (scrapers, streaming, fencing) has no external consumer beyond this file, so it's
// imported directly from its real module below instead of re-exported through here too.
export { getSystemPrompt } from "./_lib/prompts/index.js";
export { PERSONAS, DEFAULT_PERSONA_ID, resolvePersona, isPersonaAllowedForType } from "./_lib/prompts/personas.js";

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

// Selectable models. Only "gpt-oss-120b" (Groq, free tier) is ever used in production —
// see resolveProductionSafeModelOption() below, which is the actual security boundary.
// gpt-4o stays registered purely for side-by-side dev comparison (NODE_ENV=development,
// via the dev-only model picker in InputForm.jsx) — it is never reachable in production.
export const MODEL_OPTIONS = {
  "gpt-oss-120b": { label: "GPT-OSS 120B", provider: "groq", model: "openai/gpt-oss-120b" },
  "gpt-4o": { label: "GPT-4o", provider: "openai", model: "gpt-4o" },
};
export const DEFAULT_MODEL_KEY = "gpt-oss-120b";

export function resolveModelOption(modelKey) {
  return MODEL_OPTIONS[modelKey] || MODEL_OPTIONS[DEFAULT_MODEL_KEY];
}

// The production security boundary for model selection: outside of NODE_ENV=development,
// the client-requested model is ignored entirely and every request resolves to
// DEFAULT_MODEL_KEY. Takes nodeEnv as an explicit param (rather than reading
// process.env directly) so it stays a pure, easily testable function — the handler is
// the only place that reads process.env.NODE_ENV and passes it in.
export function resolveProductionSafeModelOption(modelKey, nodeEnv) {
  const isDev = nodeEnv === "development";
  return resolveModelOption(isDev ? modelKey : DEFAULT_MODEL_KEY);
}

function getRequiredApiKey(provider) {
  return provider === "groq" ? groqApiKey : openaiApiKey;
}

// Constructed lazily (not at module load) so a missing key doesn't crash the whole
// process at import time — the handler's own key checks below handle it as a normal
// 500 response instead, and this module stays importable in tests/CI without needing
// any real (or dummy) API keys set.
function getClient(modelOption) {
  return modelOption.provider === "groq"
    ? new OpenAI({ apiKey: groqApiKey, baseURL: "https://api.groq.com/openai/v1", maxRetries: 2 })
    : new OpenAI({ apiKey: openaiApiKey, maxRetries: 2 });
}

// Builds the chat.completions.create() params for the streaming roast call. Groq's
// gpt-oss models buffer their entire response server-side under `response_format:
// json_object` — confirmed by logging raw stream chunks directly against Groq: content
// arrived as a single atomic chunk instead of token-by-token, while `json_object`'s only
// effect on gpt-4o (which streams fine either way) would be marginally safer JSON. So for
// "groq" the JSON contract is enforced by the system prompt's own "Return ONLY JSON"
// instruction instead, which restores real token-by-token streaming, plus
// `reasoning_effort: "low"` — cuts the invisible reasoning phase from ~1.8s to ~500ms and
// reduces reasoning-token spend (reasoning tokens count against the free-tier rate limit
// even though they're never shown to the user). Re-run the 8-fixture eval
// (`node scripts/eval-models.mjs`) if JSON-parse failures start showing up in production
// logs (see logFailure() below) — prompt-only JSON enforcement is not a hard guarantee
// the way `response_format` is.
export function buildCompletionParams(modelOption, systemPrompt, userMessageContent) {
  const params = {
    model: modelOption.model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessageContent },
    ],
  };

  if (modelOption.provider === "groq") {
    params.reasoning_effort = "low";
  } else {
    params.response_format = { type: "json_object" };
  }

  return params;
}

// Every failure path logs one structured (JSON.stringify'd) line with code/type/model/
// persona/message — deliberately never the scraped profile content or resume text (no
// PII). `buffer` (only ever the raw model output buffer, never scraped input) is passed
// for LLM parse-failure logging specifically, truncated to 2000 chars — see
// buildCompletionParams() for why: prompt-only JSON enforcement isn't a hard guarantee,
// so this is how a reliability regression would actually get noticed.
function logFailure(err, { type, model, persona, buffer } = {}) {
  const code = err instanceof RoastError ? err.code : ERROR_CODES.INTERNAL_ERROR;
  const payload = { code, type, model, persona, message: err.message };
  if (err.cause?.message) payload.causeMessage = err.cause.message;
  if (buffer !== undefined) payload.bufferPreview = buffer.slice(0, 2000);
  console.error(JSON.stringify(payload));
  // Tags only — code/type/model/persona, never `buffer`/`bufferPreview` (the one field
  // above that can carry real model output, and by extension scraped/pasted profile
  // content) and never anything from `payload` wholesale. reportError() itself decides
  // whether this code is worth a Sentry issue (see RoastError.reportToSentry) — expected
  // user-input failures (a typo'd username, a private profile, MISSING_INPUT, ...) stay
  // in the console log above only.
  reportError(err, { code, type, model, persona });
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, type, severity = "medium", model: modelKey, persona: personaId } = req.body;
  const persona = resolvePersona(personaId);

  // Trimmed, not just truthy: a whitespace-only string is what a failed/empty PDF
  // extraction on the linkedin or resume upload path would submit if the client-side
  // guard were ever bypassed — this is the server-side backstop for that case.
  if (!String(url || "").trim() || !type) {
    const err = new RoastError(ERROR_CODES.MISSING_INPUT, "Missing url or type", { status: 400 });
    logFailure(err, { type, persona: persona.id });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  const modelOption = resolveProductionSafeModelOption(modelKey, process.env.NODE_ENV);
  const requiredApiKey = getRequiredApiKey(modelOption.provider);
  if (!requiredApiKey) {
    const err = new RoastError(
      ERROR_CODES.SERVER_MISCONFIGURED,
      `Server misconfigured: missing API key for ${modelOption.label}`,
      { status: 500 }
    );
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // allowedTypes is currently permissive for all 3 personas (every persona works with
  // every profile type), but this check is real and enforced regardless — it's what
  // makes allowedTypes ready for a future persona (e.g. a debate-mode voice) that isn't
  // valid for a straight profile roast, without needing a second enforcement pass added
  // later.
  if (!isPersonaAllowedForType(persona, type)) {
    const err = new RoastError(
      ERROR_CODES.PERSONA_NOT_ALLOWED_FOR_TYPE,
      `The "${persona.name}" persona isn't available for ${type} roasts.`,
      { status: 400 }
    );
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // Kill switch: Instagram is the only remaining scraping dependency, so it needs to be
  // disposable without a deploy if the Apify actor breaks. Checked here (same early-exit
  // spot as the persona/type check above, before rate limiting is consumed) rather than
  // inside scrapeInstagram() so a disabled request doesn't cost the caller a rate-limit
  // token for a request that was never going to succeed.
  if (type === "instagram" && !isInstagramEnabled()) {
    const err = new RoastError(
      ERROR_CODES.SOURCE_UNAVAILABLE,
      "Instagram roasts are temporarily unavailable. Try GitHub, LinkedIn, or your resume instead.",
      { status: 503, retryable: false }
    );
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // Never trust a client-sent user id — this is the server's own verification of the
  // Authorization header against Supabase Auth (api/_lib/auth.js). Resolved once and
  // reused below for the Instagram sign-in gate, rate-limit tier/key, and persistence.
  const user = await getAuthenticatedUser(req);

  // Instagram is gated behind sign-in specifically because Apify is its only paid
  // dependency (unlike GitHub's free API, or the linkedin/resume upload paths, which
  // scrape nothing at all) — distinct from the kill switch above, which is an
  // operational "Apify itself is broken" state. Same early-exit spot, same reasoning:
  // don't consume a rate-limit token for a request that was never going to succeed.
  if (type === "instagram" && !user) {
    const err = new RoastError(
      ERROR_CODES.SIGN_IN_REQUIRED,
      "Sign in to roast Instagram profiles.",
      { status: 401, retryable: false }
    );
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json(toErrorEnvelope(err));
  }

  // Rate limiting check (moved inside handler to prevent cold-start crashes). Skipped
  // entirely in development, same NODE_ENV pattern as resolveProductionSafeModelOption
  // and the debug payload below — production behavior (including the fail-open catch)
  // is untouched outside dev. rateLimitInfo stays null in the bypass case, same as the
  // existing fail-open path when Upstash itself is unreachable.
  const ip = getClientIP(req);
  const rateLimitTier = user ? "authenticated" : "anonymous";
  const rateLimitKey = getRateLimitKey(user, ip);
  let rateLimitInfo = null;
  if (process.env.NODE_ENV !== "development") {
    try {
      const ratelimit = createRatelimit(rateLimitTier);
      const { success, limit, remaining, reset } = await ratelimit.limit(rateLimitKey);
      rateLimitInfo = { limit, remaining, reset };
      if (!success) {
        // Not logged as a failure — this is expected, routine throttling, not a bug.
        // Marked non-retryable: retrying immediately would just 429 again; the client's
        // separate rateLimitStatus countdown UI is what actually tells the user when to
        // come back, not a generic "try again" affordance.
        const err = new RoastError(ERROR_CODES.RATE_LIMITED, "Too many requests. Try again later.", {
          status: 429,
          retryable: false,
        });
        return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
      }
    } catch (rateLimitError) {
      console.error("Rate limit init failed:", rateLimitError.message);
      reportError(rateLimitError, { code: "RATE_LIMIT_INIT_FAILURE" });
      // Fail open — continue without rate limiting if Upstash is unavailable
    }
  }

  const selectedSeverity = ["mild", "medium", "destroy me"].includes(severity) ? severity : "medium";

  let profileData;
  let userMessageContent;
  // The scraped username, when there is one — stored on the persisted roast row (see
  // persistRoast() below); null for linkedin/resume, which have no natural identifier
  // and whose raw pasted/PDF-extracted text is deliberately never persisted (no PII).
  let identifier = null;
  try {
    profileData = url;

    // Scrape GitHub or Instagram — cached briefly so re-roasting the same profile at a
    // different severity doesn't re-trigger a full Apify run. linkedin and resume both
    // skip scraping entirely: the request body already carries the text (pasted, or
    // extracted client-side from an uploaded PDF via pdfjs — see InputForm.jsx), so
    // profileData just stays the raw url/text as-is, same as it always has for resume.
    if (type === "github") {
      identifier = extractGithubUsername(url);
      profileData = await withScrapeCache("github", identifier, () => scrapeGithub(url));
    } else if (type === "instagram") {
      identifier = extractInstagramUsername(url);
      profileData = await withScrapeCache("instagram", identifier, () => scrapeInstagram(url));
    }

    // Build user message content - always use text-only for Instagram (no images)
    userMessageContent = type === "instagram"
      ? (typeof profileData === "object" ? profileData.text : profileData)
      : profileData;

    // Cap input length to control token cost, THEN fence it — truncating after fencing
    // would risk cutting off the closing <<<END_PROFILE_DATA_...>>> marker.
    const MAX_INPUT_LENGTH = 4000;
    if (typeof userMessageContent === "string" && userMessageContent.length > MAX_INPUT_LENGTH) {
      userMessageContent = userMessageContent.slice(0, MAX_INPUT_LENGTH);
    }
    userMessageContent = fenceUntrustedContent(userMessageContent);
  } catch (e) {
    // Scrape failures happen before we've committed to a response format (no SSE headers
    // sent yet), so these get a real HTTP status + the scraper's own specific message —
    // no canned roast. Any non-RoastError here is an actual bug, not an anticipated
    // failure mode, so it gets a generic 500 rather than leaking internals.
    const err = e instanceof RoastError ? e : new RoastError(ERROR_CODES.INTERNAL_ERROR, "Failed to prepare this roast.", {
      status: 500,
      cause: e,
    });
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  // Scraping succeeded — attempt the LLM call. This can still fail before any bytes are
  // written (bad key, network error, provider outage), in which case it gets a real HTTP
  // status just like a scrape failure. Only once we actually have a stream object back
  // do we commit to SSE — everything past that point can no longer downgrade to a status
  // code, since headers are about to be sent.
  let stream;
  try {
    stream = await getClient(modelOption).chat.completions.create(
      buildCompletionParams(modelOption, getSystemPrompt(type, selectedSeverity, persona.id), userMessageContent)
    );
  } catch (e) {
    const err = new RoastError(ERROR_CODES.LLM_UPSTREAM_FAILURE, "Failed to reach the roast model. Please try again.", {
      status: 502,
      retryable: true,
      cause: e,
    });
    logFailure(err, { type, model: modelOption.model, persona: persona.id });
    return res.status(err.status).json({ ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  }

  // Stream the roast text token-by-token over SSE as it's generated, instead of making
  // the user wait for the full `{ roast, tips }` JSON blob.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let buffer = "";
  let lastSentRoast = "";
  try {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;

      buffer += delta;
      const { text } = extractStreamingRoastText(buffer);
      if (text && text !== lastSentRoast) {
        lastSentRoast = text;
        sendSseEvent(res, "roast", { text });
      }
    }

    if (!buffer) {
      throw new RoastError(ERROR_CODES.LLM_EMPTY_RESPONSE, "The roast model returned an empty response. Please try again.", {
        retryable: true,
      });
    }

    // Because dropping `response_format: json_object` for Groq (see buildCompletionParams)
    // trades a hard syntactic guarantee for prompt-only enforcement, these two failure
    // modes are exactly what we need real-world data on — the raw buffer is logged
    // (truncated to 2000 chars) via logFailure() in the outer catch below.
    let parsed;
    try {
      parsed = JSON.parse(buffer);
    } catch (parseError) {
      throw new RoastError(
        ERROR_CODES.LLM_PARSE_FAILURE,
        "The roast model returned a response we couldn't parse. Please try again.",
        { retryable: true, cause: parseError }
      );
    }
    if (!parsed.roast || !Array.isArray(parsed.tips)) {
      throw new RoastError(
        ERROR_CODES.LLM_INVALID_FORMAT,
        "The roast model returned an incomplete response. Please try again.",
        { retryable: true }
      );
    }

    const debugPayload =
      process.env.NODE_ENV === "development"
        ? {
            _debug_scraped_data: type === "instagram" && typeof profileData === "object" ? profileData.text : profileData,
            _debug_scraped_raw: profileData,
          }
        : {};

    // Every roast is persisted, signed-in or not — an anonymous one just gets a null
    // user_id (stored for analytics, not attributed or listed in anyone's history; see
    // the migration's comment). A no-op when Supabase isn't configured, and fails open
    // on any write error — persistence must never take down a roast the caller already
    // successfully received.
    await persistRoast({
      userId: user?.id ?? null,
      type,
      identifier,
      persona: persona.id,
      severity: selectedSeverity,
      model: modelOption.label,
      roast: parsed.roast,
      tips: parsed.tips,
    });

    sendSseEvent(res, "complete", {
      roast: parsed.roast,
      tips: parsed.tips,
      modelUsed: modelOption.label,
      persona: persona.id,
      rateLimit: rateLimitInfo,
      ...debugPayload,
    });
  } catch (e) {
    // Headers (and possibly partial roast text) are already sent at this point, so a
    // failure here can't downgrade to an HTTP status — send an `error` SSE frame with
    // the real message instead of a fake `complete` event. No canned roast.
    const err = e instanceof RoastError ? e : new RoastError(ERROR_CODES.LLM_UPSTREAM_FAILURE, "Something went wrong generating this roast.", {
      retryable: true,
      cause: e,
    });
    const shouldLogBuffer = err.code === ERROR_CODES.LLM_PARSE_FAILURE || err.code === ERROR_CODES.LLM_INVALID_FORMAT;
    logFailure(err, { type, model: modelOption.model, persona: persona.id, buffer: shouldLogBuffer ? buffer : undefined });
    sendSseEvent(res, "error", { ...toErrorEnvelope(err), rateLimit: rateLimitInfo });
  } finally {
    res.end();
  }
}
