/**
 * The /platform chart of commits each week, from the repository itself.
 *
 *   node scripts/platform-pace.mjs [ref]
 *
 * Counts the commits on <ref> (default origin/master) from Monday 9 March to
 * Friday 9 October 2026 by week, and how many of each week's carry a
 * "Co-Authored-By: Claude" trailer, then writes the bar chart between
 * <!-- pace:start --> and <!-- pace:end --> in public/platform/index.html:
 * one drawing for wide screens and one for phones, with its own type size,
 * headroom and every other month named. It also writes the page's stated
 * counts and the commit they were counted at (elements marked data-count), so
 * the chart and the numbers cannot disagree.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ref = process.argv[2] ?? "origin/master";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = path.join(web, "public", "platform", "index.html");
const FROM = new Date("2026-03-09T00:00:00Z");
const UNTIL = "2026-10-09T23:59:59+01:00";
const counted = execFileSync("git", ["rev-parse", "--short=8", ref], { cwd: web, encoding: "utf8" }).trim();

const log = execFileSync("git", ["log", ref, "--since=2026-03-09T00:00:00+00:00", `--until=${UNTIL}`, "--format=%aI%x1f%B%x1e"], { cwd: web, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const commits = log.split("\x1e").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
  const [date = "", body = ""] = entry.split("\x1f");
  return { date: new Date(date), claude: /^Co-Authored-By: Claude/imu.test(body) };
});

const week = (date) => Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - FROM.getTime()) / (7 * 86_400_000));
const weeks = week(new Date(UNTIL)) + 1;
const totals = Array.from({ length: weeks }, () => ({ all: 0, claude: 0 }));
for (const commit of commits) {
  const at = week(commit.date);
  if (at < 0 || at >= weeks) continue;
  totals[at].all += 1;
  if (commit.claude) totals[at].claude += 1;
}
const all = totals.reduce((sum, w) => sum + w.all, 0);
const claude = totals.reduce((sum, w) => sum + w.claude, 0);
const peak = Math.max(...totals.map((w) => w.all));
const peakAt = totals.findIndex((w) => w.all === peak);

const round = (n) => Math.round(n * 10) / 10;
const monday = (i) => new Date(FROM.getTime() + i * 7 * 86_400_000);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (date) => `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""}`;

/** The bars and their labels in one drawing: W by H, the bars between top
 *  and base, labels at font size, every monthStep-th month named. A label is
 *  kept inside the drawing: the peak's above its bar, the months at their
 *  week, none running past either edge. */
function chart({ W, H, top, base, font, monthStep }) {
  const slot = W / weeks;
  const bar = Math.max(4, slot * 0.66);
  const scale = (base - top) / peak;
  const parts = [];
  let month = -1;
  totals.forEach((w, i) => {
    const x = round(i * slot + (slot - bar) / 2);
    const hAll = w.all * scale, hClaude = w.claude * scale;
    if (w.all > w.claude) parts.push(`<rect x="${String(x)}" y="${String(round(base - hAll))}" width="${String(round(bar))}" height="${String(round(hAll - hClaude))}" fill="rgba(242,237,221,0.3)"/>`);
    if (w.claude > 0) parts.push(`<rect x="${String(x)}" y="${String(round(base - hClaude))}" width="${String(round(bar))}" height="${String(round(hClaude))}" fill="#e2c07f"/>`);
    const start = monday(i);
    if (i === 0 || monday(i - 1).getUTCMonth() !== start.getUTCMonth()) {
      month += 1;
      if (month % monthStep === 0) {
        const label = (MONTHS[start.getUTCMonth()] ?? "").slice(0, 3);
        const wide = font * 2;
        const end = x + wide > W;
        parts.push(`<text x="${String(end ? W : x)}" y="${String(base + font * 1.9)}" fill="rgba(242,237,221,0.62)" font-size="${String(font)}" font-family="Inter, sans-serif"${end ? ' text-anchor="end"' : ""}>${label}</text>`);
      }
    }
  });
  parts.push(`<line x1="0" y1="${String(base + 0.5)}" x2="${String(W)}" y2="${String(base + 0.5)}" stroke="rgba(242,237,221,0.25)"/>`);
  const half = font * 1.2;
  const peakX = Math.min(W - half, Math.max(half, peakAt * slot + slot / 2));
  parts.push(`<text x="${String(round(peakX))}" y="${String(round(base - peak * scale - font * 0.7))}" fill="rgba(242,237,221,0.85)" font-size="${String(font)}" font-family="Inter, sans-serif" text-anchor="middle">${String(peak)}</text>`);
  return { W, H, body: parts.join("") };
}

const description = `${all.toLocaleString("en-GB")} commits from 9 March to 9 October 2026, ${claude.toLocaleString("en-GB")} of them co-written with Claude Code; the busiest week, beginning ${day(monday(peakAt))}, had ${String(peak)}.`;
const wide = chart({ W: 1200, H: 260, top: 34, base: 214, font: 15, monthStep: 1 });
const narrow = chart({ W: 600, H: 320, top: 48, base: 262, font: 22, monthStep: 2 });
const svg = [
  `<svg class="pace__chart pace__chart--wide" viewBox="0 0 ${String(wide.W)} ${String(wide.H)}" role="img" aria-labelledby="pace-title pace-desc"><title id="pace-title">Commits each week since 9 March 2026</title><desc id="pace-desc">${description}</desc>${wide.body}</svg>`,
  `<svg class="pace__chart pace__chart--narrow" viewBox="0 0 ${String(narrow.W)} ${String(narrow.H)}" role="img" aria-labelledby="pace-title-narrow pace-desc-narrow"><title id="pace-title-narrow">Commits each week since 9 March 2026</title><desc id="pace-desc-narrow">${description}</desc>${narrow.body}</svg>`,
].join("");

const page = fs.readFileSync(pagePath, "utf8");
const start = "<!-- pace:start -->";
const end = "<!-- pace:end -->";
const from = page.indexOf(start);
const to = page.indexOf(end);
if (from === -1 || to === -1 || to < from) throw new Error(`Markers ${start} … ${end} not found in ${pagePath}`);
const written = `${page.slice(0, from + start.length)}${svg}${page.slice(to)}`
  .replace(/(data-count="commits">)[^<]*/gu, `$1${all.toLocaleString("en-GB")}`)
  .replace(/(data-count="claude">)[^<]*/gu, `$1${claude.toLocaleString("en-GB")}`)
  .replace(/(data-count="commit">)[^<]*/gu, `$1${counted}`);
fs.writeFileSync(pagePath, written);
console.log(`${ref} at ${counted}: ${String(all)} commits, ${String(claude)} with Claude, ${String(weeks)} weeks, peak ${String(peak)} in the week of ${day(monday(peakAt))}`);
