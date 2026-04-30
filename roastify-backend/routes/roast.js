import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const prompts = {
  github: `You are a brutal but loving code reviewer roasting someone's GitHub profile. Roast their repos, commit history, and README quality.`,
  linkedin: `You are a brutal but loving career coach roasting someone's LinkedIn. Roast their buzzwords, job titles, and humble brags.`,
  instagram: `You are a brutal but loving social media critic roasting someone's Instagram. Roast their aesthetic, captions, and follower count.`,
  resume: `You are a brutal but loving HR manager roasting someone's resume. Roast their formatting, skills section, and objective statement.`,
};

router.post("/roast", async (req, res) => {
  const { input, type } = req.body;
  if (!input || !type) return res.status(400).json({ error: "Missing input or type" });
  if (!prompts[type]) return res.status(400).json({ error: "Invalid roast type" });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: missing OPENAI_API_KEY" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `${prompts[type]} Respond ONLY in this JSON format with no markdown:
{
  "roast": "3-5 sentence funny savage but kind roast",
  "tips": ["tip1","tip2","tip3","tip4","tip5"]
}`,
        },
        { role: "user", content: input },
      ],
    });
    res.json(JSON.parse(response.choices[0].message.content));
  } catch {
    res.status(500).json({ error: "Roast failed" });
  }
});

export default router;