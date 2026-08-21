import { describe, it, expect } from "vitest";
import { extractInstagramUsername, extractPostCaptions } from "./instagram.js";
import { ERROR_CODES, RoastError } from "../errors.js";

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

  it("throws a RoastError with SCRAPE_INVALID_INPUT / 400 / non-retryable", () => {
    try {
      extractInstagramUsername("not a username");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RoastError);
      expect(err.code).toBe(ERROR_CODES.SCRAPE_INVALID_INPUT);
      expect(err.status).toBe(400);
      expect(err.retryable).toBe(false);
    }
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
