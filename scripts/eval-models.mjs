#!/usr/bin/env node
// Standalone eval harness — NOT part of the deployed app. Runs the exact production
// system prompt (getSystemPrompt from api/roast.js) against a fixed set of profile
// fixtures (scripts/eval-fixtures.mjs), across gpt-4o (current baseline) and a set of
// open-weight candidates on OpenRouter. Writes one Markdown file per fixture, with all
// models' outputs side by side, to scripts/eval-output/ for manual comparison.
//
// Usage:
//   OPENAI_API_KEY=... OPENROUTER_API_KEY=... node scripts/eval-models.mjs
//
// Get an OpenRouter key at https://openrouter.ai/keys — pay-per-token, no subscription,
// credits don't expire. The `:free` Llama variant costs nothing while iterating.
//
// See ROASTIFY_TASKS.md section 4 for the full migration plan this script supports.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { getSystemPrompt } from "../api/roast.js";
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

export function buildModels({ openaiApiKey, openrouterApiKey }) {
  const openaiClient = new OpenAI({ apiKey: openaiApiKey });
  const openrouterClient = new OpenAI({ apiKey: openrouterApiKey, baseURL: "https://openrouter.ai/api/v1" });

  return [
    { id: "gpt-4o", label: "gpt-4o (current baseline)", client: openaiClient },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct", client: openrouterClient },
    { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", client: openrouterClient },
    // NOTE: Qwen ships multiple dated/versioned slugs on OpenRouter (this changes over
    // time) — confirm the current exact slug at https://openrouter.ai/models before
    // running. This is the task file's stated best guess, not a verified-live slug.
    { id: "qwen/qwen3-235b-a22b", label: "Qwen3 235B A22B", client: openrouterClient },
  ];
}

export async function runOne(model, fixture) {
  const start = Date.now();
  try {
    const response = await model.client.chat.completions.create({
      model: model.id,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: getSystemPrompt(fixture.type, fixture.severity) },
        { role: "user", content: fixture.profileText },
      ],
    });

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

async function main() {
  await loadEnvFile(path.join(__dirname, "..", ".env"));

  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!openaiApiKey) {
    console.error("Missing OPENAI_API_KEY (needed for the gpt-4o baseline).");
    process.exit(1);
  }
  if (!openrouterApiKey) {
    console.error("Missing OPENROUTER_API_KEY. Get one at https://openrouter.ai/keys and add it to .env.");
    process.exit(1);
  }

  const models = buildModels({ openaiApiKey, openrouterApiKey });

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
    ];

    for (const model of models) {
      process.stdout.write(`  ${model.id} ... `);
      const result = await runOne(model, fixture);
      console.log(result.ok ? `ok (${result.durationMs}ms)` : `FAILED — ${result.parseError}`);
      if (!result.ok) jsonFailures[model.id] += 1;
      sections.push(formatResult(model, result));
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
