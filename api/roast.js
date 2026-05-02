import OpenAI from "openai";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const client = new OpenAI({ apiKey });

function getClientIP(req) {
  // Try to get the real client IP from various headers
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
}

function extractGithubUsername(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new Error("Missing GitHub username");
  }

  try {
    const parsed = new URL(value.startsWith("http") ? value : `https://${value}`);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();

    if (host !== "github.com") {
      throw new Error("Invalid GitHub URL");
    }

    const username = parsed.pathname.split("/").filter(Boolean)[0];
    if (!username) {
      throw new Error("Missing GitHub username");
    }

    return username;
  } catch {
    if (/^[a-zA-Z0-9_-]+$/.test(value)) {
      return value;
    }

    throw new Error("Invalid GitHub input");
  }
}

async function scrapeGithub(input) {
  const username = extractGithubUsername(input);
  const userUrl = `https://api.github.com/users/${username}`;
  const reposUrl = `https://api.github.com/users/${username}/repos?sort=updated&per_page=10`;

  const [userResponse, reposResponse] = await Promise.all([
    fetch(userUrl),
    fetch(reposUrl),
  ]);

  if (!userResponse.ok) {
    throw new Error("GitHub user not found");
  }

  if (!reposResponse.ok) {
    throw new Error("GitHub repositories not found");
  }

  const [user, repos] = await Promise.all([
    userResponse.json(),
    reposResponse.json(),
  ]);

  const lines = [
    `GitHub Profile: ${user.name || username}`,
    `Username: ${username}`,
    `Bio: ${user.bio || "No bio provided"}`,
    `Location: ${user.location || "Unknown"}`,
    `Followers: ${user.followers}`,
    `Following: ${user.following}`,
    `Public repos: ${user.public_repos}`,
    `Account created: ${user.created_at ? new Date(user.created_at).toLocaleDateString() : "Unknown"}`,
    `Top 10 repositories:`,
  ];

  const formattedRepos = repos.slice(0, 10).map((repo, index) => {
    const stars = repo.stargazers_count ?? 0;
    const forks = repo.forks_count ?? 0;
    const language = repo.language || "Unknown";
    const description = repo.description || "No description";

    return `${index + 1}. ${repo.name} | Stars: ${stars} | Forks: ${forks} | Language: ${language} | Description: ${description}`;
  });

  return [...lines, ...formattedRepos].join("\n");
}

function getSystemPrompt(type, severity) {
  const severityInstructions = {
    mild: "Keep it light and friendly, more funny than harsh.",
    medium: "Balance funny with savage. Make it sting a little.",
    "destroy me": "Go absolutely savage. No mercy. Brutal honesty, maximum roast energy.",
  };

  const basePrompts = {
    github: `You are Ricky Gervais roasting a GitHub profile at the Golden Globes.
${severityInstructions[severity]}

TONE & STYLE (The Roast):
- Dry, nihilistic, and brutally honest.
- Use phrases like "I don't care," "Truly pathetic," and "We're all going to die anyway, why did you spend time on this?"
- Attack the vanity of the profile. Roast the "contribution graph" as a cry for help.

TONE & STYLE (The Tips):
- Provide 5-7 actionable survival tips.
- Use 5-10% Hinglish words to keep it grounded (e.g., 'Bhai', 'Jugaad', 'Scene', 'Bas').
- Example: "Fix your bio, bhai, it looks like a spam bot wrote it."

Return ONLY JSON: { "roast": "string", "tips": ["string"] }`,

    linkedin: `You are Ricky Gervais roasting a LinkedIn profile at the Golden Globes.
${severityInstructions[severity]}

TONE & STYLE (The Roast):
- Dry, nihilistic, and brutally honest.
- Attack the vanity and buzzwords in the profile. Roast the "professional" facade.
- Use phrases like "I don't care," "Truly pathetic," and "We're all going to die anyway."

TONE & STYLE (The Tips):
- Provide 5-7 actionable survival tips.
- Use 5-10% Hinglish words to keep it grounded (e.g., 'Bhai', 'Jugaad', 'Scene', 'Bas').

Return ONLY JSON: { "roast": "string", "tips": ["string"] }`,

    instagram: `You are Ricky Gervais roasting an Instagram profile at the Golden Globes.
${severityInstructions[severity]}

TONE & STYLE (The Roast):
- Dry, nihilistic, and brutally honest.
- Attack the vanity and aesthetic of the profile.
- Use phrases like "I don't care," "Truly pathetic," and "We're all going to die anyway."

TONE & STYLE (The Tips):
- Provide 5-7 actionable survival tips.
- Use 5-10% Hinglish words to keep it grounded (e.g., 'Bhai', 'Jugaad', 'Scene', 'Bas').

Return ONLY JSON: { "roast": "string", "tips": ["string"] }`,

    resume: `You are Ricky Gervais roasting a resume at the Golden Globes.
${severityInstructions[severity]}

TONE & STYLE (The Roast):
- Dry, nihilistic, and brutally honest.
- Roast the formatting, structure, buzzwords, and content gaps.
- Be savage but constructive.

TONE & STYLE (The Tips):
- Provide 5-7 actionable survival tips.
- Use 5-10% Hinglish words to keep it grounded (e.g., 'Bhai', 'Jugaad', 'Scene', 'Bas').

Return ONLY JSON: { "roast": "string", "tips": ["string"] }`,
  };

  return basePrompts[type] || basePrompts.github;
}

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, type, severity = "medium" } = req.body;

  if (!url || !type) return res.status(400).json({ error: "Missing url or type" });
  if (!apiKey) return res.status(500).json({ error: "Server misconfigured: missing API key" });

  // Debug environment variables
  console.log("REDIS URL set:", !!process.env.UPSTASH_REDIS_REST_URL);
  console.log("REDIS TOKEN set:", !!process.env.UPSTASH_REDIS_REST_TOKEN);
  console.log("OPENAI KEY set:", !!process.env.OPENAI_API_KEY);

  // Rate limiting check (moved inside handler to prevent cold-start crashes)
  const ip = getClientIP(req);
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 h"),
    });
    const { success } = await ratelimit.limit(ip);
    if (!success) {
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }
  } catch (rateLimitError) {
    console.error("Rate limit init failed:", rateLimitError.message);
    // Fail open — continue without rate limiting if Upstash is unavailable
  }

  const selectedSeverity = ["mild", "medium", "destroy me"].includes(severity) ? severity : "medium";

  try {
    let profileData = url;

    // Scrape GitHub if it's a GitHub profile
    if (type === "github") {
      profileData = await scrapeGithub(url);
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: getSystemPrompt(type, selectedSeverity),
        },
        { role: "user", content: profileData },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("Empty OpenAI response");
    }

    const parsed = JSON.parse(content);
    if (!parsed.roast || !Array.isArray(parsed.tips)) {
      throw new Error("Invalid response format");
    }

    res.json(parsed);
  } catch (e) {
    console.error(e);
    if (type === "resume") {
      return res.json(defaultResumeResponse());
    }

    res.status(500).json({ error: "Roast failed" });
  }
}