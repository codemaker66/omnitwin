/**
 * The /platform chart of commits each week, from the repository itself.
 *
 *   node scripts/platform-pace.mjs [ref]
 *
 * Counts the commits on <ref> (default origin/master) from Monday 9 March to
 * Thursday 8 October 2026 by week, and how many of each week's carry a
 * "Co-Authored-By: Claude" trailer, then writes an SVG bar chart between
 * <!-- pace:start --> and <!-- pace:end --> in public/platform/index.html.
 * It also writes the page's stated counts (elements marked data-count), so
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
const UNTIL = "2026-10-08T23:59:59+01:00";

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

const W = 1200, H = 260, top = 34, base = 214;
const slot = W / weeks;
const bar = Math.max(4, slot * 0.66);
const scale = (base - top) / peak;
const round = (n) => Math.round(n * 10) / 10;
const monday = (i) => new Date(FROM.getTime() + i * 7 * 86_400_000);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (date) => `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""}`;

const parts = [];
totals.forEach((w, i) => {
  const x = round(i * slot + (slot - bar) / 2);
  const hAll = w.all * scale, hClaude = w.claude * scale;
  if (w.all > w.claude) parts.push(`<rect x="${String(x)}" y="${String(round(base - hAll))}" width="${String(round(bar))}" height="${String(round(hAll - hClaude))}" fill="rgba(242,237,221,0.3)"/>`);
  if (w.claude > 0) parts.push(`<rect x="${String(x)}" y="${String(round(base - hClaude))}" width="${String(round(bar))}" height="${String(round(hClaude))}" fill="#e2c07f"/>`);
  const start = monday(i);
  if (i === 0 || monday(i - 1).getUTCMonth() !== start.getUTCMonth()) {
    parts.push(`<text x="${String(x)}" y="${String(base + 30)}" fill="rgba(242,237,221,0.62)" font-size="15" font-family="Inter, sans-serif">${(MONTHS[start.getUTCMonth()] ?? "").slice(0, 3)}</text>`);
  }
});
parts.push(`<line x1="0" y1="${String(base + 0.5)}" x2="${String(W)}" y2="${String(base + 0.5)}" stroke="rgba(242,237,221,0.25)"/>`);
parts.push(`<text x="${String(round(peakAt * slot + slot / 2))}" y="${String(round(base - peak * scale - 10))}" fill="rgba(242,237,221,0.85)" font-size="15" font-family="Inter, sans-serif" text-anchor="middle">${String(peak)}</text>`);

const description = `${all.toLocaleString("en-GB")} commits from 9 March to 8 October 2026, ${claude.toLocaleString("en-GB")} of them co-written with Claude Code; the busiest week, beginning ${day(monday(peakAt))}, had ${String(peak)}.`;
const svg = `<svg viewBox="0 0 ${String(W)} ${String(H)}" role="img" aria-labelledby="pace-title pace-desc"><title id="pace-title">Commits each week since 9 March 2026</title><desc id="pace-desc">${description}</desc>${parts.join("")}</svg>`;

const page = fs.readFileSync(pagePath, "utf8");
const start = "<!-- pace:start -->";
const end = "<!-- pace:end -->";
const from = page.indexOf(start);
const to = page.indexOf(end);
if (from === -1 || to === -1 || to < from) throw new Error(`Markers ${start} … ${end} not found in ${pagePath}`);
const counted = `${page.slice(0, from + start.length)}${svg}${page.slice(to)}`
  .replace(/(data-count="commits">)[^<]*/gu, `$1${all.toLocaleString("en-GB")}`)
  .replace(/(data-count="claude">)[^<]*/gu, `$1${claude.toLocaleString("en-GB")}`);
fs.writeFileSync(pagePath, counted);
console.log(`${ref}: ${String(all)} commits, ${String(claude)} with Claude, ${String(weeks)} weeks, peak ${String(peak)} in the week of ${day(monday(peakAt))}`);
