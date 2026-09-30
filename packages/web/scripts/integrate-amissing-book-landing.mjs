// Produce a new immutable CMS bundle from the exact public landing baseline.
// The game remains at /amissing-book/; the existing /quiz alias is its public door.
// Usage: node scripts/integrate-amissing-book-landing.mjs input-v5.js output-v6.js
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LANDING_BASELINE_URL = "https://www.tradeshallglasgow.co.uk/file-download/92/trades-hall-option-b-v5.js";
export const LANDING_BASELINE_SHA256 = "67c33a28fd3e42959ff2e2063b7947aada7a78157f6188c4caa75c378fc47e25";

const replacements = [
  ["Take the quiz. Find your people.", "Play the interactive game."],
  [
    "craft:{first:'Find your',second:'people.',eyebrow:'Fourteen Crafts. One living tradition.',subtitle:['Discover the Craft that connects','with who you are.'],label:'THE CRAFT QUIZ',description:['A little about you. A living tradition.','Discover where your story belongs.'],action:'Discover my Craft',url:'https://venviewer.com/quiz'}",
    "craft:{first:'The Amissing',second:'Book',eyebrow:'Fourteen Crafts. One living tradition.',subtitle:['An interactive story about Glasgow’s','14 Incorporated Crafts.'],label:'THE AMISSING BOOK',description:['An interactive story about Glasgow’s','14 Incorporated Crafts.'],action:'Play the game',url:'https://venviewer.com/quiz'}",
  ],
  [
    "Discover your connection to the fourteen Incorporated Crafts or contact Trades Hall of Glasgow to plan an event.",
    "Play The Amissing Book, an interactive story about Glasgow’s 14 Incorporated Crafts, or contact Trades Hall of Glasgow to plan an event.",
  ],
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Kept separate so focused tests can cover the edit contract without retaining
// the baseline's photographs and font payloads as another repository fixture.
export function transformLandingContent(source) {
  let output = source;
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) {
      throw new Error(`Expected exactly one landing text fragment: ${before.slice(0, 60)}`);
    }
    output = output.replace(before, after);
  }
  return output;
}

export function integrateLandingBundle(bytes) {
  const actual = digest(bytes);
  if (actual !== LANDING_BASELINE_SHA256) {
    throw new Error(`Landing source drift: expected ${LANDING_BASELINE_SHA256}, received ${actual}. Inspect the live CMS bundle before updating it.`);
  }
  return Buffer.from(transformLandingContent(bytes.toString("utf8")), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) {
    throw new Error("Usage: node scripts/integrate-amissing-book-landing.mjs input-v5.js output-v6.js");
  }
  if (resolve(input) === resolve(output)) throw new Error("The immutable input and new output must have different paths");
  const result = integrateLandingBundle(readFileSync(input));
  // Refuse to overwrite an already published/generated version.
  writeFileSync(output, result, { flag: "wx" });
  console.log(JSON.stringify({
    source: LANDING_BASELINE_URL,
    sourceSha256: LANDING_BASELINE_SHA256,
    output: resolve(output),
    bytes: result.length,
    sha256: digest(result),
  }, null, 2));
}
