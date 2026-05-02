import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

const prompts = {
  github: `You are a brutal but loving code reviewer roasting someone's GitHub profile.`,
  linkedin: `You are a brutal but loving career coach roasting someone's LinkedIn profile.`,
  instagram: `You are a brutal but loving social media critic roasting someone's Instagram.`,
  resume: `You are a brutal but loving HR manager roasting someone's resume.`,
};

function defaultResumeResponse() {
  return {
    roast: "This resume has the confidence of a keynote speech and the structure of a kitchen receipt. The content is trying to be impressive, but the formatting is making the reader work too hard to care. You have useful experience here, but the presentation is hiding it behind chaos and a suspicious amount of visual noise. Clean it up, make the sections sharper, and stop making recruiters excavate your value like it's an archaeological site.",
    tips: [
      "Use clear section headings and consistent spacing",
      "Trim filler words and vague objective statements",
      "Put the strongest achievements near the top",
      "Keep bullets short, direct, and measurable",
      "Make the layout easier to scan in under 10 seconds",
    ],
  };
}

async function scrapeGithub(url) {
  const match = url.match(/github\.com\/([a-zA-Z0-9_-]+)/i) || [null, url.trim()];
  const username = match[1];
  const [userRes, repoRes] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`),
    fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=10`),
  ]);
  const user = await userRes.json();
  const repos = await repoRes.json();
  return `
    Name: ${user.name}, Bio: ${user.bio}, Followers: ${user.followers},
    Public repos: ${user.public_repos}, Company: ${user.company}
    Top repos: ${repos.map(r => `${r.name} (${r.stargazers_count} stars, ${r.language})`).join(", ")}
  `;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, type, severity } = req.body;
  const selectedSeverity = ["mild", "medium", "destroy me"].includes(severity)
    ? severity
    : "medium";
  const severityInstructions = {
    mild: "Keep it light and friendly, more funny than harsh.",
    medium: "Balance funny with savage. Make it sting a little.",
    "destroy me": "Go absolutely savage. No mercy. Brutal honesty, maximum roast energy.",
  };
  if (!url || !type) return res.status(400).json({ error: "Missing url or type" });
  if (!apiKey) return res.status(500).json({ error: "Server misconfigured: missing API key" });

  try {
    const profileData = type === "github" ? await scrapeGithub(url) : url;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${prompts[type]} ${severityInstructions[selectedSeverity]} Respond ONLY as JSON, no markdown:
{"roast": "3-5 sentence savage but kind roast", "tips": ["tip1","tip2","tip3","tip4","tip5"]}`,
        },
        { role: "user", content: profileData },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("Empty OpenAI response");
    }

    try {
      const parsed = JSON.parse(content);
      if (!parsed.roast || !Array.isArray(parsed.tips)) {
        throw new Error("Invalid response format");
      }

      res.json(parsed);
    } catch (parseError) {
      if (type === "resume") {
        return res.json(defaultResumeResponse());
      }

      throw parseError;
    }
  } catch (e) {
    console.error(e);
    if (type === "resume") {
      return res.json(defaultResumeResponse());
    }

    res.status(500).json({ error: "Roast failed" });
  }
}