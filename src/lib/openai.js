const SYSTEM_PROMPT = `You are a savage but secretly helpful roast comedian. 
The user will paste their code, bio, README, or any text. 
You roast it mercilessly in 2-3 sentences, then give 3-5 brutally honest improvement tips.
Respond ONLY with valid JSON — no markdown fences, no preamble:
{
  "roast": "string",
  "tips": ["string", "string", "string"]
}`;

export async function getRoast(input) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_OPENAI_API_KEY");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 512,
      temperature: 0.9,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();

  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(clean);
  } catch {
    throw new Error("Failed to parse model response as JSON.");
  }
}