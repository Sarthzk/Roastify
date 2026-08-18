import OpenAI from "openai";
import { getClientIP, createRatelimit } from "./_lib/rateLimit.js";
import { withScrapeCache } from "./_lib/scrapeCache.js";
import { fetchWithRetry } from "./_lib/fetchWithRetry.js";
import { handleCorsPreflight } from "./_lib/cors.js";

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

// Selectable models — the user picks one in the UI before requesting a roast. GPT-4o
// stays available alongside the open-weight candidates for development/testing, per
// ROASTIFY_TASKS.md section 4 (evaluate before cutting over, don't swap blind).
export const MODEL_OPTIONS = {
  "gpt-4o": { label: "GPT-4o", provider: "openai", model: "gpt-4o" },
  "command-a": { label: "Command A", provider: "openrouter", model: "cohere/command-a" },
  "command-r": { label: "Command R", provider: "openrouter", model: "cohere/command-r" },
};
export const DEFAULT_MODEL_KEY = "gpt-4o";

export function resolveModelOption(modelKey) {
  return MODEL_OPTIONS[modelKey] || MODEL_OPTIONS[DEFAULT_MODEL_KEY];
}

function getRequiredApiKey(provider) {
  return provider === "openrouter" ? openrouterApiKey : openaiApiKey;
}

// Constructed lazily (not at module load) so a missing key doesn't crash the whole
// process at import time — the handler's own key checks below handle it as a normal
// 500 response instead, and this module stays importable in tests/CI without needing
// any real (or dummy) API keys set.
function getClient(modelOption) {
  return modelOption.provider === "openrouter"
    ? new OpenAI({ apiKey: openrouterApiKey, baseURL: "https://openrouter.ai/api/v1", maxRetries: 2 })
    : new OpenAI({ apiKey: openaiApiKey, maxRetries: 2 });
}

// Apify poll budget: kept short so scraping leaves enough of the 60s function
// maxDuration (see vercel.json) for the OpenAI call that follows.
const APIFY_POLL_MAX_ATTEMPTS = 10;
const APIFY_POLL_INTERVAL_MS = 2000;

export function extractGithubUsername(input) {
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
    fetchWithRetry(userUrl),
    fetchWithRetry(reposUrl),
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

export function extractInstagramUsername(input) {
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

export function extractPostCaptions(postsSource) {
  if (!Array.isArray(postsSource)) {
    return [];
  }

  return postsSource
    .map((post) => post?.caption?.text || post?.caption || post?.text || post?.title || post?.description || post?.node?.caption?.text || "")
    .filter(Boolean)
    .slice(0, 5);
}

export function extractPostImageUrls(postsSource) {
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
      // Bounded to 1 retry — this POST starts a billed actor run, so we don't want to
      // pile on retries and risk starting the same run multiple times.
      const resp = await fetchWithRetry(
        `https://api.apify.com/v2/acts/${actor}/runs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apifyToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ usernames: [username], resultsLimit: 5 }),
        },
        { retries: 1 }
      );

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
  for (let attempt = 0; attempt < APIFY_POLL_MAX_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetchWithRetry(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { Authorization: `Bearer ${apifyToken}` } },
      { retries: 1, baseDelayMs: 300 }
    );

    if (!statusResponse.ok) {
    } else {
      const statusData = await statusResponse.json();
      runStatus = statusData?.data?.status || statusData?.status;
      if (runStatus === "SUCCEEDED" || runStatus === "FAILED") {
        break;
      }
    }

    if (attempt < APIFY_POLL_MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
  }

  if (runStatus !== "SUCCEEDED") {
    throw new Error("Instagram scrape timed out");
  }

  const datasetResponse = await fetchWithRetry(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items`, {
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

export function extractLinkedInSlug(url) {
  const match = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : String(url || "").trim().toLowerCase();
}

// Tries multiple possible field paths against a scraped object (supports nested
// dot-notation paths like "profile.name"), returning the first present, non-empty value.
export function getField(obj, ...paths) {
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
      // Bounded to 1 retry — this POST starts a billed actor run, so we don't want to
      // pile on retries and risk starting the same run multiple times.
      const resp = await fetchWithRetry(
        `https://api.apify.com/v2/acts/${actor}/runs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apifyToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ profileUrls: [url], resultsLimit: 1 }),
        },
        { retries: 1 }
      );

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

  let runStatus = "RUNNING";
  for (let attempt = 0; attempt < APIFY_POLL_MAX_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetchWithRetry(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { Authorization: `Bearer ${apifyToken}` } },
      { retries: 1, baseDelayMs: 300 }
    );

    if (!statusResponse.ok) {
      throw new Error("Failed to check LinkedIn scrape status");
    }

    const statusData = await statusResponse.json();
    runStatus = statusData?.data?.status || statusData?.status;

    if (runStatus === "SUCCEEDED" || runStatus === "FAILED") {
      break;
    }

    if (attempt < APIFY_POLL_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, APIFY_POLL_INTERVAL_MS));
    }
  }

  if (runStatus !== "SUCCEEDED") {
    throw new Error(
      "Could not fetch LinkedIn profile. Make sure the URL is correct and the profile is public."
    );
  }

  const datasetResponse = await fetchWithRetry(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items`, {
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

// Incrementally extracts the value of the "roast" key from a partial JSON string as it
// streams in from the model, without waiting for the whole `{ "roast": ..., "tips": [...] }`
// object to finish. Stops (without marking complete) the moment it runs out of buffer,
// including mid-escape-sequence, so it never emits garbage for a half-received escape.
export function extractStreamingRoastText(buffer) {
  const keyMatch = buffer.match(/"roast"\s*:\s*"/);
  if (!keyMatch) {
    return { text: "", complete: false };
  }

  const escapeMap = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f" };
  let i = keyMatch.index + keyMatch[0].length;
  let text = "";
  let complete = false;

  while (i < buffer.length) {
    const ch = buffer[i];

    if (ch === "\\") {
      const next = buffer[i + 1];
      if (next === undefined) break; // incomplete escape — wait for more data

      if (next === "u") {
        const hex = buffer.slice(i + 2, i + 6);
        if (hex.length < 4) break; // incomplete unicode escape — wait for more data
        text += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else {
        text += escapeMap[next] ?? next;
        i += 2;
      }
      continue;
    }

    if (ch === '"') {
      complete = true;
      break;
    }

    text += ch;
    i += 1;
  }

  return { text, complete };
}

export function getSystemPrompt(type, severity) {
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

function defaultGithubResponse() {
  return {
    roast: "A contribution graph full of green squares and a README that says nothing real — classic. Half these repos were forked, poked once, and abandoned like a gym membership. You're not building a portfolio, bhai, you're building evidence for a crime scene. We're all going to die anyway, so at least pick a project and finish it before that happens.",
    tips: [
      "Pin your 3 strongest repos, not your 3 most recent ones",
      "Write a real README with what the project does and why",
      "Delete or archive the dead forks cluttering your profile",
      "Add a proper bio instead of leaving it blank, bas do it",
      "Commit messages should say what changed, not 'fix'",
      "Show off one finished project over five half-done ones",
    ],
  };
}

function defaultLinkedInResponse() {
  return {
    roast: "'Passionate thought leader synergizing growth' — bhai, nobody knows what your job actually is. The headline is buzzword jugaad stitched together to avoid saying anything concrete, and the About section reads like a motivational poster had a breakdown. Truly pathetic performance of a career. We're all going to die anyway, so you might as well say what you actually do for a living.",
    tips: [
      "Rewrite your headline to say the actual role you do",
      "Cut buzzwords like 'synergy' and 'thought leader' entirely",
      "Lead your About section with concrete results, not adjectives",
      "List 3-5 real skills instead of 50 vague endorsements",
      "Keep experience bullets specific — numbers over adjectives",
      "Bas, stop posting humble-brags disguised as advice",
    ],
  };
}

function defaultInstagramResponse() {
  return {
    roast: "A grid full of gym selfies, sunsets, and a bio with three emojis doing the heavy lifting of an entire personality. The captions are trying so hard to sound deep they've looped back around to saying nothing at all. It's giving 'aesthetic over substance,' bhai, and the substance clocked out a while ago. We're all going to die anyway, so maybe post something real for once.",
    tips: [
      "Write a bio that says something specific about you",
      "Cut the caption filler — say one real thing per post",
      "Post less often but keep the quality consistent, no jugaad",
      "Pick a visual theme instead of a random content dump",
      "Drop the emoji-as-personality routine, bas let the photo speak",
      "Show something you actually made, not just where you were",
    ],
  };
}

const FALLBACK_RESPONSES = {
  resume: defaultResumeResponse,
  github: defaultGithubResponse,
  linkedin: defaultLinkedInResponse,
  instagram: defaultInstagramResponse,
};

function sendSseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url, type, severity = "medium", model: modelKey } = req.body;

  if (!url || !type) return res.status(400).json({ error: "Missing url or type" });

  const modelOption = resolveModelOption(modelKey);
  const requiredApiKey = getRequiredApiKey(modelOption.provider);
  if (!requiredApiKey) {
    return res.status(500).json({ error: `Server misconfigured: missing API key for ${modelOption.label}` });
  }

  // Rate limiting check (moved inside handler to prevent cold-start crashes)
  const ip = getClientIP(req);
  let rateLimitInfo = null;
  try {
    const ratelimit = createRatelimit();
    const { success, limit, remaining, reset } = await ratelimit.limit(ip);
    rateLimitInfo = { limit, remaining, reset };
    if (!success) {
      return res.status(429).json({ error: "Too many requests. Try again later.", rateLimit: rateLimitInfo });
    }
  } catch (rateLimitError) {
    console.error("Rate limit init failed:", rateLimitError.message);
    // Fail open — continue without rate limiting if Upstash is unavailable
  }

  const selectedSeverity = ["mild", "medium", "destroy me"].includes(severity) ? severity : "medium";

  let profileData;
  let userMessageContent;
  try {
    profileData = url;

    // Scrape GitHub, Instagram, or LinkedIn — cached briefly so re-roasting the same
    // profile at a different severity doesn't re-trigger a full Apify run.
    if (type === "github") {
      profileData = await withScrapeCache("github", extractGithubUsername(url), () => scrapeGithub(url));
    } else if (type === "instagram") {
      profileData = await withScrapeCache("instagram", extractInstagramUsername(url), () => scrapeInstagram(url));
    } else if (type === "linkedin") {
      profileData = await withScrapeCache("linkedin", extractLinkedInSlug(url), () => scrapeLinkedIn(url));
    }

    // Build user message content - always use text-only for Instagram (no images)
    userMessageContent = type === "instagram"
      ? (typeof profileData === "object" ? profileData.text : profileData)
      : profileData;

    // Cap input length to control token cost and limit prompt-injection surface from untrusted profile text
    const MAX_INPUT_LENGTH = 4000;
    if (typeof userMessageContent === "string" && userMessageContent.length > MAX_INPUT_LENGTH) {
      userMessageContent = userMessageContent.slice(0, MAX_INPUT_LENGTH);
    }
  } catch (e) {
    // Scrape failures happen before we've committed to a response format, so these can
    // still be a plain JSON fallback (unlike LLM failures below, which happen mid-stream).
    console.error(e);
    const fallback = FALLBACK_RESPONSES[type];
    if (fallback) {
      return res.json({ ...fallback(), rateLimit: rateLimitInfo });
    }
    return res.status(500).json({ error: "Roast failed", rateLimit: rateLimitInfo });
  }

  // Scraping succeeded — stream the roast text token-by-token over SSE as it's generated,
  // instead of making the user wait for the full `{ roast, tips }` JSON blob.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let buffer = "";
  let lastSentRoast = "";
  try {
    const stream = await getClient(modelOption).chat.completions.create({
      model: modelOption.model,
      response_format: { type: "json_object" },
      stream: true,
      messages: [
        {
          role: "system",
          content: getSystemPrompt(type, selectedSeverity),
        },
        { role: "user", content: userMessageContent },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;

      buffer += delta;
      const { text } = extractStreamingRoastText(buffer);
      if (text && text !== lastSentRoast) {
        lastSentRoast = text;
        sendSseEvent(res, "roast", { text });
      }
    }

    if (!buffer) {
      throw new Error("Empty OpenAI response");
    }

    const parsed = JSON.parse(buffer);
    if (!parsed.roast || !Array.isArray(parsed.tips)) {
      throw new Error("Invalid response format");
    }

    const debugPayload =
      process.env.NODE_ENV === "development"
        ? {
            _debug_scraped_data: type === "instagram" && typeof profileData === "object" ? profileData.text : profileData,
            _debug_scraped_raw: profileData,
          }
        : {};

    sendSseEvent(res, "complete", {
      roast: parsed.roast,
      tips: parsed.tips,
      modelUsed: modelOption.label,
      rateLimit: rateLimitInfo,
      ...debugPayload,
    });
  } catch (e) {
    console.error(e);
    // Headers (and possibly partial roast text) are already sent at this point, so a
    // failure here can't downgrade to a plain error status — send the canned fallback
    // as a "complete" event instead; the client can't tell it apart from a real one.
    const fallback = FALLBACK_RESPONSES[type];
    const fallbackData = fallback ? fallback() : { roast: "Something went wrong generating this roast.", tips: [] };
    sendSseEvent(res, "complete", { ...fallbackData, rateLimit: rateLimitInfo });
  } finally {
    res.end();
  }
}