#!/usr/bin/env node
// Standalone eval harness — NOT part of the deployed app. Runs the exact production
// system prompt (getSystemPrompt from api/roast.js) against a fixed set of profile
// fixtures (scripts/eval-fixtures.mjs), across gpt-4o (dev-only comparison baseline)
// and Groq's free-tier candidates (persona defaults to "cynic" for this comparison —
// it's the one that matches current production output). Also runs a separate persona
// comparison per fixture — the same input across all 3 personas, against the
// production default model only (not the full model matrix; the point is reading the
// voices against each other, not a model x persona cross-product). Writes one Markdown
// file per fixture, with the
// model comparison and persona comparison sections side by side, to
// scripts/eval-output/ for manual comparison.
//
// Usage:
//   OPENAI_API_KEY=... GROQ_API_KEY=... node scripts/eval-models.mjs
//
// Get a Groq key at https://console.groq.com/keys — free tier, no credit card, rate-
// limited rather than metered, so there's no cost while iterating.
//
// See ROASTIFY_TASKS.md section 4B for the OpenRouter/Cohere → Groq migration this
// script supports, and section 7 for the persona system this script's persona
// comparison covers.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { getSystemPrompt, PERSONAS, MODEL_OPTIONS, DEFAULT_MODEL_KEY } from "../api/roast.js";
import { FIXTURES } from "./eval-fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "eval-output");

function stripQuotes(value) {
  const isQuoted =
    (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return isQuoted ? value.slice(1, -1) : value;
}

function loadEnvFile(filePath) {
  return readFile(filePath, "utf8")
    .then((contents) => {
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const separatorIndex = trimmed.indexOf("=");
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = stripQuotes(trimmed.slice(separatorIndex + 1).trim());
        if (key && process.env[key] == null) process.env[key] = value;
      }
    })
    .catch(() => {
      // No local .env file; rely on existing environment variables.
    });
}

export function buildModels({ openaiApiKey, groqApiKey }) {
  const openaiClient = new OpenAI({ apiKey: openaiApiKey });
  const groqClient = new OpenAI({ apiKey: groqApiKey, baseURL: "https://api.groq.com/openai/v1" });

  return [
    { id: "gpt-4o", label: "gpt-4o (dev-only comparison baseline)", provider: "openai", client: openaiClient },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (production default)", provider: "groq", client: groqClient },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", provider: "groq", client: groqClient },
    { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B", provider: "groq", client: groqClient },
  ];
}

export async function runOne(model, fixture, personaId) {
  const start = Date.now();
  try {
    // Mirrors buildCompletionParams() in api/roast.js (minus `stream`, since this harness
    // runs one-shot completions): Groq's gpt-oss models buffer their whole response under
    // `response_format: json_object` instead of streaming it, so production enforces JSON
    // via the system prompt alone for "groq" and adds `reasoning_effort: "low"` to cut
    // the invisible reasoning phase. Kept in sync manually — there's no shared helper
    // across the streaming/non-streaming split, so if that function changes, update here.
    // `personaId` is optional — omitted, getSystemPrompt falls back to the default
    // persona (cynic), matching what the model-comparison loop below has always run.
    const params = {
      model: model.id,
      messages: [
        { role: "system", content: getSystemPrompt(fixture.type, fixture.severity, personaId) },
        { role: "user", content: fixture.profileText },
      ],
    };
    if (model.provider === "groq") {
      params.reasoning_effort = "low";
    } else {
      params.response_format = { type: "json_object" };
    }

    const response = await model.client.chat.completions.create(params);

    const durationMs = Date.now() - start;
    const content = response.choices?.[0]?.message?.content ?? "";

    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(content);
      if (!parsed.roast || !Array.isArray(parsed.tips)) {
        parseError = "Response JSON is missing a `roast` string or `tips` array";
      }
    } catch (err) {
      parseError = `JSON.parse failed: ${err.message}`;
    }

    return { ok: !parseError, durationMs, raw: content, parsed, parseError };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      raw: null,
      parsed: null,
      parseError: `Request failed: ${err.message}`,
    };
  }
}

export function formatResult(model, result) {
  const lines = [`### ${model.label} (\`${model.id}\`)`, ""];

  if (result.parseError) {
    lines.push(`**FAILED** — ${result.parseError} _(${result.durationMs}ms)_`, "");
    if (result.raw) lines.push("Raw output:", "", "```", result.raw, "```", "");
  } else {
    lines.push(`_${result.durationMs}ms_`, "", "**Roast:**", "", result.parsed.roast, "", "**Tips:**", "");
    for (const tip of result.parsed.tips) lines.push(`- ${tip}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatPersonaResult(persona, result) {
  const lines = [`#### ${persona.name} (\`${persona.id}\`) — ${persona.tagline}`, ""];

  if (result.parseError) {
    lines.push(`**FAILED** — ${result.parseError} _(${result.durationMs}ms)_`, "");
    if (result.raw) lines.push("Raw output:", "", "```", result.raw, "```", "");
  } else {
    lines.push(`_${result.durationMs}ms_`, "", "**Roast:**", "", result.parsed.roast, "", "**Tips:**", "");
    for (const tip of result.parsed.tips) lines.push(`- ${tip}`);
    lines.push("");
  }

  return lines.join("\n");
}

// Flags what to specifically look for when reading the persona-comparison section for a
// given fixture — see ROASTIFY_TASKS.md for why these three checks matter: recruiter's
// usefulness shouldn't degrade at low intensity, desi-uncle's humor shouldn't collapse
// into just meanness at high intensity, and cynic (the pre-persona default voice) is the
// regression check — it should read the same as it always has, since it's the same
// fragment content the single hardcoded prompt used before this refactor.
function personaComparisonNotes(fixture) {
  const notes = [
    "**Regression check**: does `cynic` read the same as the current production voice? " +
      "It's composed from the exact same fragment content the old hardcoded prompt used " +
      "(see `api/_lib/prompts/personas.js`), so it shouldn't have changed.",
  ];
  if (fixture.severity === "mild") {
    notes.push("**Check**: does `recruiter` stay genuinely useful (specific, evidence-based) at `mild`, not just generically softer?");
  }
  if (fixture.severity === "destroy me") {
    notes.push("**Check**: does `desi-uncle` stay funny at `destroy me`, not just harsher — and does it stay affectionate underneath (no family/caste/class cruelty)?");
  }
  return notes;
}

async function main() {
  await loadEnvFile(path.join(__dirname, "..", ".env"));

  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!openaiApiKey) {
    console.error("Missing OPENAI_API_KEY (needed for the gpt-4o comparison baseline).");
    process.exit(1);
  }
  if (!groqApiKey) {
    console.error("Missing GROQ_API_KEY. Get one at https://console.groq.com/keys (free tier) and add it to .env.");
    process.exit(1);
  }

  const models = buildModels({ openaiApiKey, groqApiKey });

  // Persona comparison runs against the production default model only (not the full
  // model matrix) — the point is reading the three voices against identical input, not
  // a model x persona cross-product. Reuses the client already built above for that
  // model rather than constructing a new one.
  const personaComparisonModel = models.find((m) => m.id === MODEL_OPTIONS[DEFAULT_MODEL_KEY].model);
  const personaList = Object.values(PERSONAS);

  await mkdir(OUTPUT_DIR, { recursive: true });

  const jsonFailures = Object.fromEntries(models.map((m) => [m.id, 0]));

  for (const fixture of FIXTURES) {
    console.log(`\n=== ${fixture.id} (${fixture.type} / ${fixture.severity}) ===`);

    const sections = [
      `# ${fixture.id} — ${fixture.type} / ${fixture.severity}`,
      "",
      "<details><summary>Input profile text</summary>",
      "",
      "```",
      fixture.profileText,
      "```",
      "",
      "</details>",
      "",
      "## Model comparison (persona: cynic, the default)",
      "",
    ];

    for (const model of models) {
      process.stdout.write(`  ${model.id} ... `);
      const result = await runOne(model, fixture);
      console.log(result.ok ? `ok (${result.durationMs}ms)` : `FAILED — ${result.parseError}`);
      if (!result.ok) jsonFailures[model.id] += 1;
      sections.push(formatResult(model, result));
    }

    if (personaComparisonModel) {
      sections.push(`## Persona comparison (model: ${personaComparisonModel.label})`, "");
      for (const note of personaComparisonNotes(fixture)) sections.push(`- ${note}`);
      sections.push("");

      for (const persona of personaList) {
        process.stdout.write(`  persona:${persona.id} ... `);
        const result = await runOne(personaComparisonModel, fixture, persona.id);
        console.log(result.ok ? `ok (${result.durationMs}ms)` : `FAILED — ${result.parseError}`);
        sections.push(formatPersonaResult(persona, result));
      }
    }

    await writeFile(path.join(OUTPUT_DIR, `${fixture.id}.md`), sections.join("\n"));
  }

  console.log("\n=== JSON parse failures per model ===");
  for (const model of models) {
    console.log(`${model.id}: ${jsonFailures[model.id]}/${FIXTURES.length}`);
  }
  console.log(`\nResults written to ${OUTPUT_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
