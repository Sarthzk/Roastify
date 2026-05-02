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

function extractInstagramUsername(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new Error("Missing Instagram username");
  }

  const match = value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?<username>[A-Za-z0-9._-]+)\/?(?:\?.*)?$/i);

  if (match?.groups?.username) {
    return match.groups.username;
  }

  // Fallback: accept plain username if it matches Instagram username pattern
  if (/^[a-zA-Z0-9._-]+$/.test(value)) {
    return value;
  }

  throw new Error("Invalid Instagram input");
}

function extractPostCaptions(postsSource) {
  if (!Array.isArray(postsSource)) {
    return [];
  }

  return postsSource
    .map((post) => post?.caption?.text || post?.caption || post?.text || post?.title || post?.description || post?.node?.caption?.text || "")
    .filter(Boolean)
    .slice(0, 5);
}

function extractPostImageUrls(postsSource) {
  if (!Array.isArray(postsSource)) {
    return [];
  }

  const imageUrls = [];

  for (const post of postsSource) {
    if (!post) continue;

    // Try common image URL fields
    const imageUrl =
      post?.displayUrl ||
      post?.thumbnailUrl ||
      post?.imageUrl ||
      post?.image_url ||
      post?.src ||
      post?.media_url ||
      post?.node?.display_url ||
      post?.node?.thumbnail_src ||
      post?.node?.media?.display_url;

    if (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("http")) {
      imageUrls.push(imageUrl);
    }

    // Check for images array
    if (Array.isArray(post?.images) && post.images.length > 0) {
      for (const image of post.images) {
        const url = image?.url || image?.displayUrl || image?.src;
        if (url && typeof url === "string" && url.startsWith("http")) {
          imageUrls.push(url);
        }
      }
    }

    if (imageUrls.length >= 5) break;
  }

  return imageUrls.slice(0, 5);
}

async function scrapeInstagram(url) {
  const username = extractInstagramUsername(url);
  const apifyToken = String(process.env.APIFY_API_TOKEN || "").trim();
  if (!apifyToken) {
    throw new Error("Missing Apify API token");
  }

  const actorCandidates = [
    "apify~instagram-profile-scraper",
    "apify~instagram-scraper",
    "data-slayer~instagram-profile-scraper",
    "apify~instagram-scraper-v2",
  ];

  let startData = null;
  let runId = null;
  let defaultDatasetId = null;
  const errors = [];

  for (const actor of actorCandidates) {
    try {
      const resp = await fetch(`https://api.apify.com/v2/acts/${actor}/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ usernames: [username], resultsLimit: 5 }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "(no body)");
        errors.push({ actor, status: resp.status, body: text });
        continue;
      }

      startData = await resp.json();
      runId = startData?.data?.id || startData?.id;
      defaultDatasetId = startData?.data?.defaultDatasetId || startData?.defaultDatasetId;
      break;
    } catch (err) {
      errors.push({ actor, error: err.message });
    }
  }

  if (!runId || !defaultDatasetId) {
    console.error("All Instagram actor attempts failed:", JSON.stringify(errors));
    throw new Error("Failed to start Instagram scrape");
  }

  // Poll actor run status until SUCCEEDED or FAILED (timeout after attempts)
  let runStatus = "RUNNING";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: {
        Authorization: `Bearer ${apifyToken}`,
      },
    });

    if (!statusResponse.ok) {
    } else {
      const statusData = await statusResponse.json();
      runStatus = statusData?.data?.status || statusData?.status;
      if (runStatus === "SUCCEEDED" || runStatus === "FAILED") {
        break;
      }
    }

    if (attempt < 14) await new Promise((r) => setTimeout(r, 3000));
  }

  if (runStatus !== "SUCCEEDED") {
    throw new Error("Instagram scrape timed out");
  }

  const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items`, {
    headers: {
      Authorization: `Bearer ${apifyToken}`,
    },
  });

  if (!datasetResponse.ok) {
    throw new Error("Failed to fetch Instagram scrape results");
  }

  const items = await datasetResponse.json();
  const firstItem = Array.isArray(items) ? items[0] : null;

  if (!firstItem) {
    throw new Error("This Instagram account is private or does not exist.");
  }

  const profileSource = firstItem.profile || firstItem.account || firstItem;
  const postsSource = firstItem.postsData || firstItem.latestPosts || firstItem.latestPostsData || firstItem.posts || firstItem.postsData?.items || [];
  const latestPosts = extractPostCaptions(postsSource);

  if (!profileSource.username && !profileSource.fullName && !profileSource.bio && !profileSource.biography) {
    throw new Error("This Instagram account is private or does not exist.");
  }

  const profileBio = profileSource.bio || profileSource.biography || "No bio provided";
  const followersCount = profileSource.followersCount ?? profileSource.followers ?? profileSource.edge_followed_by?.count ?? "Unknown";
  const followingCount = profileSource.followsCount ?? profileSource.following ?? profileSource.edge_follow?.count ?? "Unknown";
  const postsCount = profileSource.postsCount ?? profileSource.posts ?? profileSource.edge_owner_to_timeline_media?.count ?? "Unknown";
  const isVerified = Boolean(profileSource.isVerified ?? profileSource.verified ?? profileSource.is_verified);

  const lines = [
    `Username: ${profileSource.username || username}`,
    `Full name: ${profileSource.fullName || profileSource.full_name || profileSource.fullName || "Unknown"}`,
    `Bio: ${profileBio}`,
    `Followers: ${followersCount}`,
    `Following: ${followingCount}`,
    `Posts count: ${postsCount}`,
    `Is verified: ${isVerified}`,
    `Latest 5 post captions:`,
  ];

  const captionLines = latestPosts.length
    ? latestPosts.map((caption, index) => `${index + 1}. ${caption}`)
    : ["1. No public post captions found"];

  const textContent = [...lines, ...captionLines].join("\n");
  const imageUrls = extractPostImageUrls(postsSource);

  return {
    text: textContent,
    imageUrls,
  };
}

async function scrapeLinkedIn(url) {
  // Validate LinkedIn URL
  if (!String(url || "").includes("linkedin.com/in/")) {
    throw new Error("Invalid LinkedIn URL. Use https://linkedin.com/in/username");
  }

  const apifyToken = String(process.env.APIFY_API_TOKEN || "").trim();
  if (!apifyToken) {
    throw new Error("Missing Apify API token");
  }

  // Try multiple known actor names to be resilient against actor name changes
  const actorCandidates = [
    "apify~linkedin-profile-scraper",
    "data-slayer~linkedin-profile-scraper",
    "apify~linkedin-scraper",
    "data-slayer~linkedin-scraper",
  ];

  let startData = null;
  const errors = [];
  let runId = null;
  let defaultDatasetId = null;

  for (const actor of actorCandidates) {
    try {
      const resp = await fetch(`https://api.apify.com/v2/acts/${actor}/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ profileUrls: [url], resultsLimit: 1 }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "(no body)");
        errors.push({ actor, status: resp.status, body: text });
        continue;
      }

      startData = await resp.json();
      runId = startData?.data?.id || startData?.id;
      defaultDatasetId = startData?.data?.defaultDatasetId || startData?.defaultDatasetId;
      // found a working actor
      break;
    } catch (err) {
      errors.push({ actor, error: err.message });
    }
  }

  if (!runId || !defaultDatasetId) {
    console.error("All LinkedIn actor attempts failed:", JSON.stringify(errors));
    throw new Error("Failed to start LinkedIn scrape");
  }

  if (!runId || !defaultDatasetId) {
    throw new Error("Failed to start LinkedIn scrape");
  }

  let runStatus = "RUNNING";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const statusResponse = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers: {
        Authorization: `Bearer ${apifyToken}`,
      },
    });

    if (!statusResponse.ok) {
      throw new Error("Failed to check LinkedIn scrape status");
    }

    const statusData = await statusResponse.json();
    runStatus = statusData?.data?.status || statusData?.status;

    if (runStatus === "SUCCEEDED" || runStatus === "FAILED") {
      break;
    }

    if (attempt < 14) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (runStatus !== "SUCCEEDED") {
    throw new Error(
      "Could not fetch LinkedIn profile. Make sure the URL is correct and the profile is public."
    );
  }

  const datasetResponse = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items`, {
    headers: {
      Authorization: `Bearer ${apifyToken}`,
    },
  });

  if (!datasetResponse.ok) {
    throw new Error("Failed to fetch LinkedIn scrape results");
  }

  const items = await datasetResponse.json();
  const firstItem = Array.isArray(items) ? items[0] : null;

  if (!firstItem) {
    throw new Error(
      "Could not fetch LinkedIn profile. Make sure the URL is correct and the profile is public."
    );
  }
  // Helper to try multiple possible field paths (supports nested with dot notation)
  function getField(obj, ...paths) {
    for (const path of paths) {
      if (!path) continue;
      const parts = String(path).split(".");
      let cur = obj;
      let ok = true;
      for (const p of parts) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
          cur = cur[p];
        } else {
          ok = false;
          break;
        }
      }
      if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
    }
    return undefined;
  }

  // Extract fields with broader fallbacks and nested paths
  const fullName =
    getField(
      firstItem,
      "fullName",
      "name",
      "profileName",
      "profile.fullName",
      "profile.name",
      "publicName",
      "displayName",
      "profileFullName"
    ) || "Unknown";

  const headline = getField(firstItem, "headline", "title", "profile.headline", "profile.title") || "Unknown";

  const location =
    getField(firstItem, "location", "geoLocation", "profile.location", "contact.location") || "Unknown";

  const about =
    getField(firstItem, "about", "summary", "description", "profile.about", "profile.summary") || "No summary provided";

  const followerCount =
    getField(firstItem, "followers", "followerCount", "followersCount", "stats.followers") || "Unknown";
  const connections = getField(firstItem, "connections", "connectionCount", "connectionsCount") || "Unknown";

  // Current company/role (try multiple nested sources)
  let currentCompany =
    getField(
      firstItem,
      "currentCompany",
      "profile.currentCompany",
      "experiences.0.company",
      "positions.0.company",
      "workExperience.0.company"
    ) || "Unknown";

  let currentRole =
    getField(
      firstItem,
      "currentRole",
      "profile.currentRole",
      "experiences.0.title",
      "positions.0.title",
      "workExperience.0.title"
    ) || "Unknown";

  // Top 3 experiences
  const experiences = firstItem.experiences || firstItem.workExperience || firstItem.positions || [];
  const topExperiences = (Array.isArray(experiences) ? experiences : [])
    .slice(0, 3)
    .map((exp) => {
      const company = exp.company || exp.companyName || exp.employer || "Unknown";
      const title = exp.title || exp.role || exp.position || "Unknown";
      const duration = exp.duration || exp.period || `${exp.startDate || ""} - ${exp.endDate || "Present"}`.trim();
      return `${company} | ${title} | ${duration}`;
    });

  // Education
  const education = firstItem.education || firstItem.educations || firstItem.schools || [];
  const educationLines = (Array.isArray(education) ? education : [])
    .slice(0, 3)
    .map((ed) => {
      const school = ed.school || ed.institution || ed.schoolName || "Unknown";
      const degree = ed.degree || ed.qualification || ed.degreeName || "";
      const field = ed.fieldOfStudy || ed.field || ed.area || "";
      return `${school}${degree ? ` | ${degree}` : ""}${field ? ` | ${field}` : ""}`;
    });

  // Skills
  const skillsArr = firstItem.skills || firstItem.topSkills || firstItem.skillsList || [];
  const skills = (Array.isArray(skillsArr) ? skillsArr : []).slice(0, 10).map((s) => (typeof s === "string" ? s : s.name || s.skill || JSON.stringify(s)));

  const lines = [
    `Full name: ${fullName}`,
    `Headline: ${headline}`,
    `Location: ${location}`,
    `About: ${about}`,
    `Current company: ${currentCompany}`,
    `Current role: ${currentRole}`,
    `Followers: ${followerCount}`,
    `Connections: ${connections}`,
    `Top 3 work experiences:`,
    ...(topExperiences.length ? topExperiences.map((t, i) => `${i + 1}. ${t}`) : ["1. No work experience found"]),
    `Education:`,
    ...(educationLines.length ? educationLines.map((e, i) => `${i + 1}. ${e}`) : ["1. No education found"]),
    `Top skills:`,
    ...(skills.length ? skills.map((s, i) => `${i + 1}. ${s}`) : ["1. No skills found"]),
  ];

  return lines.join("\n");
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

    // Scrape GitHub, Instagram, or LinkedIn
    if (type === "github") {
      profileData = await scrapeGithub(url);
    } else if (type === "instagram") {
      profileData = await scrapeInstagram(url);
    } else if (type === "linkedin") {
      profileData = await scrapeLinkedIn(url);
    }

    // Build user message content - always use text-only for Instagram (no images)
    const userMessageContent = type === "instagram"
      ? (typeof profileData === "object" ? profileData.text : profileData)
      : profileData;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: getSystemPrompt(type, selectedSeverity),
        },
        { role: "user", content: userMessageContent },
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

    // Include raw scraped data for debugging/testing
    // For Instagram, include the text portion; for LinkedIn include the scraped string
    const debugData = type === "instagram" && typeof profileData === "object" ? profileData.text : profileData;
    res.json({
      ...parsed,
      _debug_scraped_data: debugData,
      _debug_scraped_raw: profileData,
    });
  } catch (e) {
    console.error(e);
    if (type === "resume") {
      return res.json(defaultResumeResponse());
    }

    res.status(500).json({ error: "Roast failed" });
  }
}