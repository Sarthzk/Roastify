import { fetchWithRetry } from "../fetchWithRetry.js";
import { ERROR_CODES, RoastError } from "../errors.js";

export function extractGithubUsername(input) {
  const value = String(input || "").trim();

  if (!value) {
    throw new RoastError(ERROR_CODES.SCRAPE_INVALID_INPUT, "Missing GitHub username", { status: 400 });
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

    throw new RoastError(ERROR_CODES.SCRAPE_INVALID_INPUT, "Invalid GitHub input", { status: 400 });
  }
}

export async function scrapeGithub(input) {
  const username = extractGithubUsername(input);
  const userUrl = `https://api.github.com/users/${username}`;
  const reposUrl = `https://api.github.com/users/${username}/repos?sort=updated&per_page=10`;

  const [userResponse, reposResponse] = await Promise.all([
    fetchWithRetry(userUrl),
    fetchWithRetry(reposUrl),
  ]);

  if (!userResponse.ok) {
    throw new RoastError(ERROR_CODES.SCRAPE_NOT_FOUND, "GitHub user not found", { status: 404 });
  }

  if (!reposResponse.ok) {
    // The repos endpoint returns 200 (with an empty array) for any real user, even one
    // with zero repos — a non-2xx here means GitHub itself is rate-limiting or down, not
    // that the user doesn't exist.
    throw new RoastError(ERROR_CODES.SCRAPE_UPSTREAM_FAILURE, "GitHub repositories not found", {
      status: 502,
      retryable: true,
    });
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
