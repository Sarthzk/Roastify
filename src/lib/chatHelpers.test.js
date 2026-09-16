import { describe, it, expect } from "vitest";
import { formatDate, lastMessagePreview } from "./chatHelpers";

describe("formatDate", () => {
  it("formats an ISO timestamp as 'DD mon', zero-padded, lowercase month", () => {
    expect(formatDate("2026-09-05T12:00:00Z")).toBe("05 sep");
  });

  it("does not zero-pad the month name, only the day", () => {
    expect(formatDate("2026-01-31T00:00:00Z")).toBe("31 jan");
  });
});

describe("lastMessagePreview", () => {
  it("returns an honest empty-state string when there is no last message", () => {
    expect(lastMessagePreview(null)).toBe("No messages yet — say something.");
    expect(lastMessagePreview(undefined)).toBe("No messages yet — say something.");
  });

  it("prefixes the caller's own message with 'you:'", () => {
    expect(lastMessagePreview({ role: "user", content: "what about my other repos?" })).toBe(
      "you: what about my other repos?"
    );
  });

  it("does not prefix the persona's reply", () => {
    expect(lastMessagePreview({ role: "assistant", content: "Fine, one thing you did right." })).toBe(
      "Fine, one thing you did right."
    );
  });
});
