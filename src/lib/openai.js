import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true 
});

export async function getRoast(url, type) {
  const systemPrompt = `
    You are Ricky Gervais roasting a ${type} profile at the Golden Globes.
    
    TONE & STYLE (The Roast):
    - Dry, nihilistic, and brutally honest. 
    - Use phrases like "I don't care," "Truly pathetic," and "We're all going to die anyway, why did you spend time on this?"
    - Attack the vanity of the profile. If it's LinkedIn, roast the "professional" facade. If it's GitHub, roast the "contribution graph" as a cry for help.
    
    TONE & STYLE (The Tips):
    - Provide 5-7 actionable survival tips.
    - Use 5-10% Hinglish words to keep it grounded (e.g., 'Bhai', 'Jugaad', 'Scene', 'Bas').
    - Example: "Fix your bio, bhai, it looks like a spam bot wrote it."
    
    Return ONLY JSON: { "roast": "string", "tips": ["string"] }
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Roast this: ${url}` }
    ],
    response_format: { type: "json_object" }
  });

  return JSON.parse(response.choices[0].message.content);
}