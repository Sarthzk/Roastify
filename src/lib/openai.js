import OpenAI from "openai";

const client = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

export async function getRoast(input) {
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a brutally honest but secretly supportive career coach.
Given a user's portfolio/profile, respond ONLY in this JSON format with no markdown:
{
  "roast": "3-5 sentence funny savage but kind roast",
  "tips": ["tip1","tip2","tip3","tip4","tip5"]
}`,
      },
      { role: "user", content: input },
    ],
  });

  return JSON.parse(res.choices[0].message.content);
}