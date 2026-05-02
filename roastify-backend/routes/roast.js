import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const prompts = {
  github: `You are a brutal but loving code reviewer. Given a GitHub profile/repository information, roast their projects, code quality, commit history, and repo organization. Be funny but constructive.`,
  linkedin: `You are a brutal but loving career coach. Given LinkedIn profile information, roast their buzzwords, job titles, and professional journey. Be witty but insightful.`,
  instagram: `You are a brutal but loving social media critic. Given Instagram profile information, roast their aesthetic, captions, and follower engagement. Be savage but supportive.`,
  resume: `You are a brutal but loving HR manager. The user pastes their raw resume text. Roast their formatting, skills section, objective statement, and job history gaps. Be savage but give real advice.`,
};

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

async function fetchProfileData(url, type) {
  const urlObj = new URL(url);
  
  if (type === "github") {
    // Extract GitHub username from URL
    const match = url.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
    if (!match) throw new Error("Invalid GitHub URL. Use https://github.com/username");
    
    const username = match[1];
    const apiUrl = `https://api.github.com/users/${username}`;
    
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("GitHub user not found");
      
      const user = await res.json();
      return `GitHub Profile: ${user.name || username}
Public Repos: ${user.public_repos}
Followers: ${user.followers}
Following: ${user.following}
Bio: ${user.bio || "No bio"}
Company: ${user.company || "No company"}
Location: ${user.location || "Unknown"}
Blog: ${user.blog || "No blog"}
Created: ${new Date(user.created_at).toLocaleDateString()}
Updated: ${new Date(user.updated_at).toLocaleDateString()}`;
    } catch {
      throw new Error("Failed to fetch GitHub profile");
    }
  }
  
  if (type === "linkedin") {
    // LinkedIn profiles aren't publicly accessible via API without auth
    // Return a message asking user to share details
    return `LinkedIn Profile: ${url}
Since LinkedIn profiles require authentication to access, please share the following details for an accurate roast:
- Current Job Title
- Current Company
- Years of Experience
- Number of Connections
- Headline/About Section
- Recent roles and transitions`;
  }
  
  if (type === "instagram") {
    // Instagram profiles are private without auth
    return `Instagram Profile: ${url}
Since Instagram profiles require authentication to access, please share:
- Bio
- Follower count
- Following count
- Recent post captions (or description of posts)
- Account type (personal/business/creator)`;
  }

  if (type === "resume") {
    return `Resume Content:\n${url}`;
  }
  
  throw new Error("Unsupported profile type");
}

router.post("/roast", async (req, res) => {
  const { input, url, type, severity } = req.body;
  const profileInput = input || url;
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  const selectedSeverity = ["mild", "medium", "destroy me"].includes(severity)
    ? severity
    : "medium";
  const severityInstructions = {
    mild: "Keep it light and friendly, more funny than harsh.",
    medium: "Balance funny with savage. Make it sting a little.",
    "destroy me": "Go absolutely savage. No mercy. Brutal honesty, maximum roast energy.",
  };

  if (!profileInput || !type) return res.status(400).json({ error: "Missing input or type" });
  if (!prompts[type]) return res.status(400).json({ error: "Invalid profile type (github, linkedin, instagram, resume)" });
  if (!apiKey) {
    return res.status(500).json({ error: "Server misconfigured: missing API key" });
  }

  try {
    // Validate URL format
    if (type !== "resume") {
      new URL(profileInput);
    }
  } catch {
    if (type !== "github" && type !== "resume") {
      return res.status(400).json({ error: "Invalid URL format" });
    }
  }

  try {
    let profileData;

    if (type === "github") {
      try {
        profileData = await scrapeGithub(profileInput);
      } catch {
        profileData = `could not fetch profile, user provided: ${profileInput}`;
      }
    } else {
      profileData = await fetchProfileData(profileInput, type);
    }
    
    // For non-GitHub profiles, check if it's a guidance message (starts with "Since")
    if (type !== "github" && profileData.includes("Since")) {
      // Return guidance message as a special response
      return res.json({
        roast: profileData,
        tips: [
          "Share the details mentioned above in the input field",
          "The more info you provide, the spicier the roast",
          "Be honest for a more accurate roast",
          "Tips will be generated once we have your profile data"
        ],
      });
    }
    
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${prompts[type]} ${severityInstructions[selectedSeverity]} Respond ONLY in this JSON format with no markdown:
{
  "roast": "3-5 sentence funny savage but kind roast",
  "tips": ["tip1","tip2","tip3","tip4","tip5"]
}`,
        },
        { role: "user", content: `Roast this profile:\n\n${profileData}` },
      ],
    });
    
    const responseText = response.choices[0].message.content;
    if (!responseText) {
      throw new Error("Empty OpenAI response");
    }
    const parsed = JSON.parse(responseText);
    
    if (!parsed.roast || !Array.isArray(parsed.tips)) {
      throw new Error("Invalid response format");
    }
    
    res.json(parsed);
  } catch (e) {
    console.error("Roast error:", e.message || e);
    res.status(500).json({ error: e.message || "Roast failed" });
  }
});

export default router;