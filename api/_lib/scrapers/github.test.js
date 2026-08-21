import { describe, it, expect } from "vitest";
import { extractGithubUsername } from "./github.js";
import { ERROR_CODES, RoastError } from "../errors.js";

describe("extractGithubUsername", () => {
  it("extracts the username from a full profile URL", () => {
    expect(extractGithubUsername("https://github.com/octocat")).toBe("octocat");
  });

  it("extracts the username from a bare domain with no protocol", () => {
    expect(extractGithubUsername("github.com/octocat")).toBe("octocat");
  });

  it("accepts a plain username", () => {
    expect(extractGithubUsername("octocat")).toBe("octocat");
  });

  it("strips trailing path segments like /repos", () => {
    expect(extractGithubUsername("https://github.com/octocat/repos")).toBe("octocat");
  });

  it("is case-insensitive about the host, including www", () => {
    expect(extractGithubUsername("https://www.GITHUB.com/octocat")).toBe("octocat");
  });

  it("rejects a URL from a different host", () => {
    expect(() => extractGithubUsername("https://gitlab.com/octocat")).toThrow();
  });

  it("rejects empty input", () => {
    expect(() => extractGithubUsername("")).toThrow("Missing GitHub username");
  });

  it("rejects input that isn't a valid URL or username", () => {
    expect(() => extractGithubUsername("not a url!!")).toThrow("Invalid GitHub input");
  });

  it("throws a RoastError with SCRAPE_INVALID_INPUT / 400 / non-retryable", () => {
    try {
      extractGithubUsername("");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RoastError);
      expect(err.code).toBe(ERROR_CODES.SCRAPE_INVALID_INPUT);
      expect(err.status).toBe(400);
      expect(err.retryable).toBe(false);
    }

    try {
      extractGithubUsername("not a valid username!!");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RoastError);
      expect(err.code).toBe(ERROR_CODES.SCRAPE_INVALID_INPUT);
      expect(err.status).toBe(400);
    }
  });
});
