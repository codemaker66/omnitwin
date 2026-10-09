/**
 * The /platform page's step 5: Claude's draft of the Crawford message with the
 * coordinator's edits marked, written between the crawford-edit markers in
 * index.html. Both texts come from e2e/support/platform-sample.ts, so the
 * page shows exactly the draft the captures show (Claude's, verbatim) and
 * exactly the message her page shows (the sample edit). Struck text is the
 * draft's alone, marked text the message's alone; reading the block without
 * one or the other gives back each text whole, which the page's guard test
 * checks.
 *
 *   node scripts/platform-edit.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAUDE_CRAWFORD_DRAFT, CRAWFORD_SENT_MESSAGE } from "../e2e/support/platform-sample.ts";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = path.join(web, "public", "platform", "index.html");

/** Words, figures, single marks and the spaces between them, each its own
 *  token: "£13,200.00," is a figure and a comma, so a figure that only lost
 *  its pence stays the same figure and a comma added after a date is just a
 *  comma. */
const TOKEN = /\s+|£?\d(?:[\d,]*\d)?(?:\.\d+)?|[\p{L}\p{N}]+(?:['’]\p{L}+)*|\S/gu;
function tokens(text) {
  const found = text.match(TOKEN) ?? [];
  if (found.join("") !== text) throw new Error("The tokens do not spell the text back.");
  return found;
}

/** The longest common subsequence of two token lists, walked into one step
 *  per token: kept (in both), cut (the draft's alone) or added (the
 *  message's alone). */
function align(a, b) {
  const cols = b.length + 1;
  const table = new Uint16Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { steps.push({ op: "keep", token: a[i] }); i += 1; j += 1; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) { steps.push({ op: "cut", token: a[i] }); i += 1; }
    else { steps.push({ op: "add", token: b[j] }); j += 1; }
  }
  while (i < a.length) { steps.push({ op: "cut", token: a[i] }); i += 1; }
  while (j < b.length) { steps.push({ op: "add", token: b[j] }); j += 1; }
  return steps;
}

/** One token changed into one token that shares its start or end, marked by
 *  the characters that changed: "£13,200.00" to "£13,200" strikes ".00"
 *  alone. Anything else is marked whole (null). */
function refine(cut, added, html) {
  if (/\s/u.test(cut) || /\s/u.test(added)) return null;
  let head = 0;
  while (head < cut.length && head < added.length && cut[head] === added[head]) head += 1;
  let tail = 0;
  while (tail < cut.length - head && tail < added.length - head
    && cut[cut.length - 1 - tail] === added[added.length - 1 - tail]) tail += 1;
  if (head + tail < 2) return null;
  const middle = (text) => text.slice(head, text.length - tail);
  const struck = middle(cut) === "" ? "" : `<del>${html(middle(cut))}</del>`;
  const marked = middle(added) === "" ? "" : `<ins>${html(middle(added))}</ins>`;
  return `${html(cut.slice(0, head))}${struck}${marked}${html(cut.slice(cut.length - tail))}`;
}

/** The steps as text, each change a phrase: changes joined only by spaces are
 *  one change, its struck side the draft's words there and its marked side
 *  the message's, spaces and all. */
function marks(steps, html) {
  let out = "";
  let at = 0;
  while (at < steps.length) {
    if (steps[at].op === "keep") { out += html(steps[at].token); at += 1; continue; }
    // The change runs on through spaces kept between changes.
    let end = at;
    for (let next = at + 1; next < steps.length; next += 1) {
      if (steps[next].op !== "keep") end = next;
      else if (steps[next].token.trim() !== "") break;
    }
    let cut = "";
    let added = "";
    for (let k = at; k <= end; k += 1) {
      if (steps[k].op !== "add") cut += steps[k].token;
      if (steps[k].op !== "cut") added += steps[k].token;
    }
    const fine = cut === "" || added === "" ? null : refine(cut, added, html);
    if (fine !== null) out += fine;
    else {
      if (cut !== "") out += `<del>${html(cut)}</del>`;
      if (added !== "") out += `<ins>${html(added)}</ins>`;
    }
    at = end + 1;
  }
  return out;
}

// Verbatim: Claude's straight apostrophes stay as it wrote them; line breaks stay line breaks.
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const html = (text) => escape(text).replaceAll("\n", "<br>");
const marked = marks(align(tokens(CLAUDE_CRAWFORD_DRAFT), tokens(CRAWFORD_SENT_MESSAGE)), html);

let page = await fs.readFile(pagePath, "utf8");
const start = "<!-- crawford-edit:start -->";
const end = "<!-- crawford-edit:end -->";
const from = page.indexOf(start);
const to = page.indexOf(end);
if (from === -1 || to === -1 || to < from) throw new Error(`Markers ${start} … ${end} not found in ${pagePath}`);
page = `${page.slice(0, from + start.length)}${marked}${page.slice(to)}`;
await fs.writeFile(pagePath, page);
const cuts = (marked.match(/<del>/gu) ?? []).length;
const adds = (marked.match(/<ins>/gu) ?? []).length;
console.log(`edit: ${String(cuts)} cut, ${String(adds)} added, ${String(marked.length)} characters`);
