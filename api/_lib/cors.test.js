import { describe, it, expect } from "vitest";
import { applyCors } from "./cors.js";

function corsResFor(origin) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  applyCors({ headers: { origin } }, res);
  return res.headers["Access-Control-Allow-Origin"];
}

describe("applyCors origin allowlist", () => {
  it("allows the production origin", () => {
    expect(corsResFor("https://roastify-two.vercel.app")).toBe("https://roastify-two.vercel.app");
  });

  it("allows this project's Vercel preview deployment origins", () => {
    expect(corsResFor("https://roastify-two-abc123.vercel.app")).toBe("https://roastify-two-abc123.vercel.app");
    expect(corsResFor("https://roastify-two-git-feature-x-sarthzk.vercel.app")).toBe(
      "https://roastify-two-git-feature-x-sarthzk.vercel.app"
    );
  });

  it("allows localhost at any port, for local dev", () => {
    expect(corsResFor("http://localhost:5173")).toBe("http://localhost:5173");
    expect(corsResFor("http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("rejects an unrelated origin", () => {
    expect(corsResFor("https://evil.com")).toBeUndefined();
  });

  it("rejects a spoofing attempt that merely starts with the allowed origin", () => {
    expect(corsResFor("https://roastify-two.vercel.app.evil.com")).toBeUndefined();
  });

  it("rejects a missing origin header", () => {
    expect(corsResFor(undefined)).toBeUndefined();
  });
});
