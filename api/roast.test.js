import { describe, it, expect } from "vitest";
import {
  extractGithubUsername,
  extractInstagramUsername,
  extractLinkedInSlug,
  extractPostCaptions,
  extractPostImageUrls,
  extractStreamingRoastText,
  getField,
  resolveModelOption,
  MODEL_OPTIONS,
  DEFAULT_MODEL_KEY,
} from "./roast.js";

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
});

describe("extractInstagramUsername", () => {
  it("extracts the username from a profile URL", () => {
    expect(extractInstagramUsername("https://instagram.com/someone")).toBe("someone");
  });

  it("extracts the username from a URL with www and a trailing slash", () => {
    expect(extractInstagramUsername("https://www.instagram.com/someone/")).toBe("someone");
  });

  it("extracts the username ignoring a query string", () => {
    expect(extractInstagramUsername("https://instagram.com/someone/?hl=en")).toBe("someone");
  });

  it("accepts a plain username with dots and underscores", () => {
    expect(extractInstagramUsername("some.one_x")).toBe("some.one_x");
  });

  it("rejects empty input", () => {
    expect(() => extractInstagramUsername("")).toThrow("Missing Instagram username");
  });

  it("rejects input containing spaces", () => {
    expect(() => extractInstagramUsername("not a username")).toThrow("Invalid Instagram input");
  });
});

describe("extractLinkedInSlug", () => {
  it("extracts the /in/ slug from a profile URL", () => {
    expect(extractLinkedInSlug("https://www.linkedin.com/in/jane-doe/")).toBe("jane-doe");
  });

  it("lowercases the slug so caching is case-insensitive", () => {
    expect(extractLinkedInSlug("https://linkedin.com/in/Jane-Doe")).toBe("jane-doe");
  });

  it("ignores a trailing query string", () => {
    expect(extractLinkedInSlug("https://linkedin.com/in/jane-doe?trk=abc")).toBe("jane-doe");
  });

  it("falls back to a normalized full string when no /in/ slug is present", () => {
    expect(extractLinkedInSlug("  Some Raw Input  ")).toBe("some raw input");
  });
});

describe("extractPostCaptions", () => {
  it("returns an empty array for non-array input", () => {
    expect(extractPostCaptions(null)).toEqual([]);
    expect(extractPostCaptions(undefined)).toEqual([]);
    expect(extractPostCaptions("not an array")).toEqual([]);
  });

  it("extracts captions across the different known post shapes", () => {
    const posts = [
      { caption: { text: "first" } },
      { caption: "second" },
      { text: "third" },
      { title: "fourth" },
      { description: "fifth" },
      { node: { caption: { text: "sixth" } } },
    ];
    expect(extractPostCaptions(posts)).toEqual(["first", "second", "third", "fourth", "fifth"]);
  });

  it("skips posts with no usable caption field", () => {
    const posts = [{ caption: "" }, {}, { caption: "kept" }];
    expect(extractPostCaptions(posts)).toEqual(["kept"]);
  });

  it("caps the result at 5 captions", () => {
    const posts = Array.from({ length: 8 }, (_, i) => ({ caption: `caption-${i}` }));
    const result = extractPostCaptions(posts);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("caption-0");
  });
});

describe("extractPostImageUrls", () => {
  it("returns an empty array for non-array input", () => {
    expect(extractPostImageUrls(null)).toEqual([]);
  });

  it("collects http(s) image URLs across the known field names", () => {
    const posts = [
      { displayUrl: "https://example.com/a.jpg" },
      { node: { display_url: "https://example.com/b.jpg" } },
      { images: [{ url: "https://example.com/c.jpg" }] },
    ];
    expect(extractPostImageUrls(posts)).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
      "https://example.com/c.jpg",
    ]);
  });

  it("ignores non-string and non-http image values", () => {
    const posts = [{ displayUrl: "not-a-url" }, { displayUrl: 12345 }, { displayUrl: "https://example.com/ok.jpg" }];
    expect(extractPostImageUrls(posts)).toEqual(["https://example.com/ok.jpg"]);
  });

  it("caps the result at 5 image URLs", () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({ displayUrl: `https://example.com/${i}.jpg` }));
    expect(extractPostImageUrls(posts)).toHaveLength(5);
  });
});

describe("getField", () => {
  it("returns the first present value across simple paths", () => {
    expect(getField({ b: "value" }, "a", "b")).toBe("value");
  });

  it("resolves nested dot-path fields", () => {
    expect(getField({ profile: { name: "Jane" } }, "name", "profile.name")).toBe("Jane");
  });

  it("skips null, undefined, and empty-string values in earlier paths", () => {
    expect(getField({ a: "", b: null, c: undefined, d: "found" }, "a", "b", "c", "d")).toBe("found");
  });

  it("returns undefined when no path matches", () => {
    expect(getField({}, "a", "b.c")).toBeUndefined();
  });

  it("treats falsy-but-present values like 0 as found, not missing", () => {
    expect(getField({ count: 0 }, "count")).toBe(0);
  });
});

describe("resolveModelOption", () => {
  it("resolves each known model key to its registered option", () => {
    expect(resolveModelOption("gpt-4o")).toEqual(MODEL_OPTIONS["gpt-4o"]);
    expect(resolveModelOption("command-a")).toEqual(MODEL_OPTIONS["command-a"]);
    expect(resolveModelOption("command-r")).toEqual(MODEL_OPTIONS["command-r"]);
  });

  it("falls back to the default model for an unknown key", () => {
    expect(resolveModelOption("not-a-real-model")).toEqual(MODEL_OPTIONS[DEFAULT_MODEL_KEY]);
  });

  it("falls back to the default model when no key is given", () => {
    expect(resolveModelOption(undefined)).toEqual(MODEL_OPTIONS[DEFAULT_MODEL_KEY]);
  });

  it("routes OpenRouter models through the openrouter provider with the correct slug", () => {
    expect(resolveModelOption("command-a")).toMatchObject({ provider: "openrouter", model: "cohere/command-a" });
    expect(resolveModelOption("command-r")).toMatchObject({ provider: "openrouter", model: "cohere/command-r" });
  });

  it("routes gpt-4o through the openai provider", () => {
    expect(resolveModelOption("gpt-4o")).toMatchObject({ provider: "openai", model: "gpt-4o" });
  });
});

describe("extractStreamingRoastText", () => {
  it("returns empty/incomplete when the roast key hasn't appeared yet", () => {
    expect(extractStreamingRoastText('{"ro')).toEqual({ text: "", complete: false });
    expect(extractStreamingRoastText("")).toEqual({ text: "", complete: false });
  });

  it("extracts partial text from a still-open roast string", () => {
    expect(extractStreamingRoastText('{"roast": "Hello there')).toEqual({
      text: "Hello there",
      complete: false,
    });
  });

  it("marks complete once the closing quote is reached", () => {
    expect(extractStreamingRoastText('{"roast": "Hello world", "tips": [')).toEqual({
      text: "Hello world",
      complete: true,
    });
  });

  it("decodes standard JSON escape sequences", () => {
    expect(extractStreamingRoastText('{"roast": "line one\\nline two\\ttabbed"')).toEqual({
      text: "line one\nline two\ttabbed",
      complete: true,
    });
  });

  it("decodes unicode escapes", () => {
    expect(extractStreamingRoastText('{"roast": "spicy \\u00e9\\u00e9\\u00e9"')).toEqual({
      text: "spicy ééé",
      complete: true,
    });
  });

  it("does not treat an escaped quote as the closing quote", () => {
    expect(extractStreamingRoastText('{"roast": "He said \\"hi\\" and left')).toEqual({
      text: 'He said "hi" and left',
      complete: false,
    });
  });

  it("completes correctly after an escaped quote near the end", () => {
    expect(extractStreamingRoastText('{"roast": "He said \\"hi\\"", "tips": []}')).toEqual({
      text: 'He said "hi"',
      complete: true,
    });
  });

  it("waits for more data on a trailing incomplete escape", () => {
    expect(extractStreamingRoastText('{"roast": "abc\\')).toEqual({ text: "abc", complete: false });
    expect(extractStreamingRoastText('{"roast": "abc\\u00')).toEqual({ text: "abc", complete: false });
  });
});
