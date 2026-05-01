import OpenAI from 'openai';

// This pulls the key from your .env file
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true // Required since we have no backend
});

export async function getRoast(url, type) {
  // 1. Define the personality
  const systemPrompt = `You are a savage, high-standard tech recruiter. 
  Roast this ${type} profile brutally: ${url}. 
  Focus on bad bios, mid projects, and cringe headers.
  Provide 5 actionable, serious tips to fix it.
  Return ONLY JSON: { "roast": "string", "tips": ["string"] }`;

  // 2. Execute the call
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Roast this: ${url}` }
    ],
    response_format: { type: "json_object" }
  });

  // 3. Parse and return to App.jsx
  return JSON.parse(response.choices[0].message.content);
}