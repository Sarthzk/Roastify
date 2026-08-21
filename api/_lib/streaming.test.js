import { describe, it, expect } from "vitest";
import { extractStreamingRoastText } from "./streaming.js";

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
