#!/usr/bin/env node
// Regenerates public/og-image.png — the link-preview card for og:image/twitter:image
// (see index.html). Standalone, like the other scripts/ files — not part of the
// deployed app, run manually whenever the site's look changes.
//
// Usage: node scripts/generate-og-image.mjs [url]   (default: production)
//
// A real screenshot of the live home page, not a hand-drawn approximation — the previous
// SVG version drifted out of date the moment the design changed. Captured signed out (a
// fresh, throwaway Chrome profile) so no account handle ever lands in a public image,
// rendered at 2x and downscaled with sharp so text stays crisp at 1200x630.
//
// Needs Google Chrome installed; set CHROME_PATH if it isn't at the macOS default.

import sharp from "sharp";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;
const url = process.argv[2] ?? "https://roastify-two.vercel.app/";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const workDir = mkdtempSync(path.join(tmpdir(), "og-image-"));
const shotPath = path.join(workDir, "shot.png");
const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "og-image.png");

const chrome = spawn(chromePath, [
  "--headless=new",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  `--window-size=${WIDTH},${HEIGHT}`,
  // Lets fonts and the rate-limit-status fetch settle before the capture.
  "--virtual-time-budget=8000",
  `--user-data-dir=${path.join(workDir, "profile")}`,
  `--screenshot=${shotPath}`,
  url,
], { stdio: "ignore" });

// Headless Chrome writes the screenshot but doesn't always exit afterwards, so wait for
// the file rather than the process.
const deadline = Date.now() + 60_000;
while (!existsSync(shotPath)) {
  if (Date.now() > deadline) {
    chrome.kill();
    throw new Error(`Chrome produced no screenshot of ${url} within 60s`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
await new Promise((resolve) => setTimeout(resolve, 500));
chrome.kill();

await sharp(shotPath).resize(WIDTH, HEIGHT).png().toFile(outputPath);
rmSync(workDir, { recursive: true, force: true });

console.log(`Wrote ${outputPath} from ${url}`);
