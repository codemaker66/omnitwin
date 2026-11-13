#!/usr/bin/env node
// Rewrites the zod 3 spellings that zod 4 deprecates into their zod 4 forms,
// so `@typescript-eslint/no-deprecated` passes. Run it on a branch that
// predates the zod 4 upgrade (PR #179) after rebasing onto it:
//
//   node tools/zod4-modernize.mjs --write $(git diff --name-only origin/master -- '*.ts' '*.tsx')
//
// Without --write it only reports what it would change. Every rewrite is the
// same operation in zod 4's own source, so no schema changes what it accepts,
// returns or reports:
//
//   z.string().uuid(p)           -> z.uuid(p)        (also email, url, jwt, emoji, cuid, cuid2,
//                                                    nanoid, ulid, base64, base64url, ipv4, ipv6,
//                                                    cidrv4, cidrv6, guid, e164)
//   z.string().datetime(p)       -> z.iso.datetime(p) (also date, time, duration)
//   z.string().trim().email(p)   -> z.string().trim().check(z.email(p))  (a format after another
//                                                    link keeps its place, so checks run in order)
//   .safe(p) on z.number()       -> .int(p)
//   .finite() on z.number()      -> removed (zod 4 numbers are finite)
//   .passthrough()               -> .loose()
//   z.ZodIssueCode.custom        -> "custom"
//   z.ZodIssue                   -> z.core.$ZodIssue
//   z.ZodTypeAny, z.ZodSchema    -> z.ZodType
//
// Not rewritten, because the zod 4 form differs: `.merge(B)` takes B's
// strictness and refinements while `.extend(B.shape)` keeps the first
// schema's. The script lists each `.merge(` for a person to decide. A format
// or number check called on a variable rather than a literal z.string() or
// z.number() chain is left for lint to find.
import { readFileSync, writeFileSync } from "node:fs";

const write = process.argv[2] === "--write";
const files = process.argv.slice(write ? 3 : 2).filter((file) => /\.(ts|tsx|mts|cts)$/.test(file));

const STRING_FORMATS = new Set([
  "uuid", "email", "url", "jwt", "emoji", "cuid", "cuid2", "nanoid", "ulid", "base64", "base64url",
  "ipv4", "ipv6", "cidrv4", "cidrv6", "guid", "e164",
]);
const ISO_FORMATS = new Set(["datetime", "date", "time", "duration"]);

function skipSpace(text, start) {
  let i = start;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith("//", i)) {
      const next = text.indexOf("\n", i);
      if (next < 0) return text.length;
      i = next;
      continue;
    }
    if (text.startsWith("/*", i)) {
      i = text.indexOf("*/", i) + 2;
      continue;
    }
    return i;
  }
}

function closeBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced braces");
}

// The index just past the ")" that closes the "(" at `open`.
function closeParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") { i++; continue; }
      if (quote === "`" && c === "$" && text[i + 1] === "{") { i = closeBrace(text, i + 1) - 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i) + 1; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced parentheses");
}

// The ".name(args)" links that follow `start`.
function chain(text, start) {
  const links = [];
  let i = start;
  for (;;) {
    const dot = skipSpace(text, i);
    if (text[dot] !== ".") return links;
    const match = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(dot, dot + 80));
    if (match === null) return links;
    const open = dot + match[0].length - 1;
    const end = closeParen(text, open);
    links.push({ name: match[1], dot, open, end });
    i = end;
  }
}

function inComment(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index);
  return prefix.includes("//") || /^\s*\*/.test(prefix);
}

// Removes a link, and its line too when the link stands alone on it.
function removal(text, link) {
  const lineStart = text.lastIndexOf("\n", link.dot - 1) + 1;
  const newline = text.indexOf("\n", link.end);
  const lineEnd = newline < 0 ? text.length : newline;
  const alone = /^\s*$/.test(text.slice(lineStart, link.dot)) && /^\s*$/.test(text.slice(link.end, lineEnd));
  return alone
    ? { start: lineStart, end: newline < 0 ? text.length : newline + 1, text: "" }
    : { start: link.dot, end: link.end, text: "" };
}

function rewrite(text) {
  const edits = [];
  const counts = {};
  const bump = (rule) => { counts[rule] = (counts[rule] ?? 0) + 1; };

  for (const m of text.matchAll(/\bz\s*\.\s*(string|coerce\s*\.\s*string)\s*\(\s*\)/g)) {
    if (inComment(text, m.index)) continue;
    const literalString = m[1] === "string";
    chain(text, m.index + m[0].length).forEach((link, index) => {
      const iso = ISO_FORMATS.has(link.name);
      if (!iso && !STRING_FORMATS.has(link.name)) return;
      const args = text.slice(link.open + 1, link.end - 1);
      const factory = `z.${iso ? "iso." : ""}${link.name}`;
      if (index === 0 && literalString) {
        edits.push({ start: m.index, end: link.end, text: `${factory}(${args})` });
        bump(`z.string().${link.name}() -> ${factory}()`);
      } else {
        edits.push({ start: link.dot, end: link.end, text: `.check(${factory}(${args}))` });
        bump(`.${link.name}() -> .check(${factory}())`);
      }
    });
  }

  for (const m of text.matchAll(/\bz\s*\.\s*(number|coerce\s*\.\s*number|int)\s*\(\s*\)/g)) {
    if (inComment(text, m.index)) continue;
    for (const link of chain(text, m.index + m[0].length)) {
      if (link.name === "finite") {
        edits.push(removal(text, link));
        bump(".finite() removed");
      } else if (link.name === "safe") {
        edits.push({ start: link.dot, end: link.open, text: ".int" });
        bump(".safe() -> .int()");
      }
    }
  }

  const simple = [
    [/\.passthrough\(\s*\)/g, ".loose()", ".passthrough() -> .loose()"],
    [/\bz\.ZodIssueCode\.custom\b/g, '"custom"', 'z.ZodIssueCode.custom -> "custom"'],
    [/\bz\.ZodIssue\b(?!Code)/g, "z.core.$ZodIssue", "z.ZodIssue -> z.core.$ZodIssue"],
    [/\bz\.(ZodTypeAny|ZodSchema)\b/g, "z.ZodType", "z.ZodTypeAny|ZodSchema -> z.ZodType"],
  ];
  for (const [pattern, replacement, rule] of simple) {
    for (const m of text.matchAll(pattern)) {
      if (inComment(text, m.index)) continue;
      edits.push({ start: m.index, end: m.index + m[0].length, text: replacement });
      bump(rule);
    }
  }

  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  for (let k = 1; k < edits.length; k++) {
    if (edits[k].start < edits[k - 1].end) throw new Error(`overlapping rewrites at offset ${String(edits[k].start)}`);
  }
  let out = text;
  for (const edit of [...edits].reverse()) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);

  const merges = [];
  for (const m of out.matchAll(/\.merge\(/g)) {
    if (!inComment(out, m.index)) merges.push(out.slice(0, m.index).split("\n").length);
  }
  return { out, counts, merges };
}

const total = {};
const mergeSites = [];
let changed = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/from\s+["']zod["']/.test(text)) continue;
  let result;
  try {
    result = rewrite(text);
  } catch (error) {
    console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    continue;
  }
  if (result.out !== text) {
    changed++;
    if (write) writeFileSync(file, result.out);
  }
  for (const [rule, count] of Object.entries(result.counts)) total[rule] = (total[rule] ?? 0) + count;
  for (const line of result.merges) mergeSites.push(`${file}:${String(line)}`);
}
console.log(JSON.stringify({ written: write, filesChanged: changed, rewrites: total }, null, 2));
if (mergeSites.length > 0) {
  console.log("\n.merge( calls to decide by hand (zod 4 .merge takes the second schema's strictness and refinements):");
  for (const site of mergeSites) console.log(`  ${site}`);
}
