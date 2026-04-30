import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const prompts = {
  github: `You are a brutal but loving code reviewer. Given a GitHub profile/repository information, roast their projects, code quality, commit history, and repo organization. Be funny but constructive.`,
  linkedin: `You are a brutal but loving career coach. Given LinkedIn profile information, roast their buzzwords, job titles, and professional journey. Be witty but insightful.`,
  instagram: `You are a brutal but loving social media critic. Given Instagram profile information, roast their aesthetic, captions, and follower engagement. Be savage but supportive.`,
  twitter: `You are a brutal but loving internet personality critic. Given Twitter/X profile information, roast their tweets, engagement, and online persona. Be hilarious but helpful.`,
};

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
  
  if (type === "twitter") {
    // Twitter/X - extract username and return message
    const match = url.match(/twitter\.com\/([a-zA-Z0-9_]+)|x\.com\/([a-zA-Z0-9_]+)/i);
    if (!match) throw new Error("Invalid Twitter/X URL. Use https://twitter.com/username or https://x.com/username");
    
    const username = match[1] || match[2];
    return `Twitter/X Profile: ${url}
To get a spicy roast, please share:
- Bio
- Follower count
- Tweet style (serious/memes/rants/promotions)
- Most common topics you tweet about
- Follower engagement level`;
  }
  
  throw new Error("Unsupported profile type");
}

router.post("/roast", async (req, res) => {
  const { url, type } = req.body;
  if (!url || !type) return res.status(400).json({ error: "Missing url or type" });
  if (!prompts[type]) return res.status(400).json({ error: "Invalid profile type (github, linkedin, instagram, twitter)" });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: missing OPENAI_API_KEY" });
  }

  try {
    // Validate URL format
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  try {
    const profileData = await fetchProfileData(url, type);
    
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
        { role: "user", content: `Roast this profile:\n\n${profileData}` },
      ],
    });
    
    const responseText = response.choices[0].message.content;
    const parsed = JSON.parse(responseText);
    
    if (!parsed.roast || !Array.isArray(parsed.tips)) {
      throw new Error("Invalid response format");
    }
    
    res.json(parsed);
  } catch (e) {
    console.error("Roast error:", e);
    res.status(500).json({ error: "Roast failed" });
  }
});

export default router;