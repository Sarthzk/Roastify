import { describe, it, expect, afterEach } from "vitest";
import { isInstagramEnabled } from "./config.js";

describe("isInstagramEnabled", () => {
  const originalValue = process.env.INSTAGRAM_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.INSTAGRAM_ENABLED;
    else process.env.INSTAGRAM_ENABLED = originalValue;
  });

  it("is enabled when the var is unset", () => {
    delete process.env.INSTAGRAM_ENABLED;
    expect(isInstagramEnabled()).toBe(true);
  });

  it("is enabled for any value other than the literal string 'false'", () => {
    process.env.INSTAGRAM_ENABLED = "true";
    expect(isInstagramEnabled()).toBe(true);
    process.env.INSTAGRAM_ENABLED = "0";
    expect(isInstagramEnabled()).toBe(true);
  });

  it("is disabled only when the var is exactly 'false'", () => {
    process.env.INSTAGRAM_ENABLED = "false";
    expect(isInstagramEnabled()).toBe(false);
  });
});
