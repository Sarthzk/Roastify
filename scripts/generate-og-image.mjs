#!/usr/bin/env node
// Regenerates public/og-image.png — the link-preview card for og:image/twitter:image
// (see index.html). Standalone, like the other scripts/ files — not part of the
// deployed app, run manually whenever the card needs to change.
//
// Usage: node scripts/generate-og-image.mjs
//
// Composes an SVG (black background, amber wordmark, the same monospace treatment as
// the live site) and rasterizes it with sharp. The colors below are copied from
// src/index.css's --ground/--accent/--ink tokens — this is a static asset, not CSS, so
// it can't reference them directly and must be kept in sync by hand if those tokens
// change (same reasoning as RoastCard.jsx's one hardcoded-hex exception).

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIDTH = 1200;
const HEIGHT = 630;

const GROUND = "#000000";
const ACCENT = "#e2b714";
const INK = "#d4d3c9";
const RULE = "#2c2e31";
// SVG text rendering here goes through librsvg (via sharp), which resolves fonts against
// whatever's actually installed on the machine running this script — not a browser's CSS
// engine, so the site's own --font-family ('Courier New', monospace) can silently fall
// back to a serif on a machine where "Courier New" isn't registered under that exact
// name. Menlo first (bundled with macOS) keeps the two "GET"/"ROASTED" headline lines and
// the wordmark/tagline rendering the same monospace face consistently; 'Courier New' and
// the generic monospace stay as fallbacks for regenerating on Windows/Linux.
const FONT_FAMILY = "Menlo, 'Courier New', monospace";

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${GROUND}" />

  <!-- brand mark, top-left — same square-plus-wordmark pairing as the site header -->
  <rect x="72" y="72" width="18" height="18" fill="${ACCENT}" />
  <text x="104" y="89" font-family="${FONT_FAMILY}" font-size="26" font-weight="700"
        letter-spacing="10" fill="${ACCENT}">ROASTIFY</text>

  <!-- display headline, mirroring the hero's own "Get / Roasted" treatment -->
  <text x="70" y="330" font-family="${FONT_FAMILY}" font-size="150" font-weight="700"
        fill="${ACCENT}">GET</text>
  <text x="70" y="470" font-family="${FONT_FAMILY}" font-size="150" font-weight="700"
        fill="${ACCENT}">ROASTED</text>

  <rect x="72" y="500" width="140" height="4" fill="${ACCENT}" />

  <text x="72" y="560" font-family="${FONT_FAMILY}" font-size="26" fill="${INK}">
    Get roasted by AI on GitHub, LinkedIn, Instagram, or your resume.
  </text>

  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="none" stroke="${RULE}" stroke-width="2" />
</svg>
`;

const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "og-image.png");

const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(outputPath, buffer);

console.log(`Wrote ${outputPath} (${buffer.length} bytes)`);
