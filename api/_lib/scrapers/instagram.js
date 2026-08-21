import { ERROR_CODES, RoastError } from "../errors.js";
import { runApifyScrape } from "./apify.js";

export function extractInstagramUsername(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new RoastError(ERROR_CODES.SCRAPE_INVALID_INPUT, "Missing Instagram username", { status: 400 });
  }

  const match = value.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?<username>[A-Za-z0-9._-]+)\/?(?:\?.*)?$/i);

  if (match?.groups?.username) {
    return match.groups.username;
  }

  // Fallback: accept plain username if it matches Instagram username pattern
  if (/^[a-zA-Z0-9._-]+$/.test(value)) {
    return value;
  }

  throw new RoastError(ERROR_CODES.SCRAPE_INVALID_INPUT, "Invalid Instagram input", { status: 400 });
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

export async function scrapeInstagram(url) {
  const username = extractInstagramUsername(url);
  const apifyToken = String(process.env.APIFY_API_TOKEN || "").trim();
  if (!apifyToken) {
    throw new RoastError(ERROR_CODES.SERVER_MISCONFIGURED, "Missing Apify API token", { status: 500 });
  }

  const { succeeded, firstItem } = await runApifyScrape({
    actorCandidates: [
      "apify~instagram-profile-scraper",
      "apify~instagram-scraper",
      "data-slayer~instagram-profile-scraper",
      "apify~instagram-scraper-v2",
    ],
    requestBody: { usernames: [username], resultsLimit: 5 },
    apifyToken,
    startFailureMessage: "Failed to start Instagram scrape",
    datasetFetchFailureMessage: "Failed to fetch Instagram scrape results",
  });

  if (!succeeded) {
    throw new RoastError(ERROR_CODES.SCRAPE_TIMEOUT, "Instagram scrape timed out", { status: 504, retryable: true });
  }

  if (!firstItem) {
    throw new RoastError(ERROR_CODES.SCRAPE_NOT_FOUND, "This Instagram account is private or does not exist.", {
      status: 404,
    });
  }

  const profileSource = firstItem.profile || firstItem.account || firstItem;
  const postsSource = firstItem.postsData || firstItem.latestPosts || firstItem.latestPostsData || firstItem.posts || firstItem.postsData?.items || [];
  const latestPosts = extractPostCaptions(postsSource);

  if (!profileSource.username && !profileSource.fullName && !profileSource.bio && !profileSource.biography) {
    throw new RoastError(ERROR_CODES.SCRAPE_NOT_FOUND, "This Instagram account is private or does not exist.", {
      status: 404,
    });
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

  return { text: textContent };
}
