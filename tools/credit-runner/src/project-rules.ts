/**
 * The repository's rules for an unattended run, taken from AGENTS.md.
 *
 * On master CLAUDE.md is a one-line `@AGENTS.md` import, which an agent that
 * reads only the repository does not expand. AGENTS.md is written for
 * interactive sessions: it points at the local credentials folder, asks for
 * deployment and live checks, and tells sessions to update the task list and the
 * day's session log. Those parts are removed here rather than contradicted by an
 * override, so an unattended agent is never told where secrets live or to ship.
 *
 * Filtering is by sentence, so one sentence that needs a person or a deployment
 * does not take its neighbours with it, and it is by content as well as by
 * heading, so a reworded AGENTS.md cannot carry deployment text through.
 */

/** Level-2 sections that only an interactive session can act on. */
const DROPPED_SECTIONS: readonly RegExp[] = [/^Local CMS credentials\b/iu, /^Current delivery instruction\b/iu];

/**
 * Sentences (or list items) that point an unattended run at secrets, at files
 * the day's sessions own, at a person to ask, or at deployment and live checks.
 */
const DROPPED_SENTENCES: readonly RegExp[] = [
  /deploy-secrets/iu,
  /docs\/sessions\//u,
  /docs\/state\/tasks\.md/u,
  /\bAsk only for a material decision\b/u,
  /\bdeploy(?:s|ed|ing|ment|ments)?\b/iu,
  /\blive[- ](?:flow|verification|check|site|app|production|environment)\b/iu,
  /\b(?:through|to) delivery\b/iu,
  /\bshipping contract\b/iu,
  /\bshipping-changes\b/iu,
];

/**
 * Locations a rules file must never carry to a run: the deploy-secrets folder,
 * a drive path, a user profile folder or a key folder.
 */
const FORBIDDEN = /deploy-secrets|\b[A-Za-z]:[\\/]|\bUsers[\\/]|credit-runner-keys|%USERPROFILE%/iu;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/u;

/** Sentences end at . ! or ? followed by space and a capital letter, backtick, bracket or quote. */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\s*\n\s*/gu, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z`[("])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function keepSentence(sentence: string): boolean {
  return !DROPPED_SENTENCES.some((pattern) => pattern.test(sentence));
}

function filterParagraph(text: string): string | null {
  const kept = sentencesOf(text).filter(keepSentence);
  return kept.length === 0 ? null : kept.join(" ");
}

/** A list is filtered item by item (an item is kept or dropped whole), so one matching bullet does not take its neighbours with it. */
function filterBlock(block: string): string | null {
  const lines = block.split("\n");
  if (!LIST_ITEM.test(lines[0] ?? "")) return filterParagraph(block);
  const items: string[][] = [];
  for (const line of lines) {
    if (LIST_ITEM.test(line) || items.length === 0) items.push([line]);
    else items[items.length - 1]?.push(line);
  }
  const kept = items.map((item) => item.join("\n")).filter((item) => sentencesOf(item).every(keepSentence));
  return kept.length === 0 ? null : kept.join("\n");
}

export function nightRulesFromAgentsMd(agentsMd: string): string {
  const text = agentsMd.replace(/\r\n?/gu, "\n");
  const sections: string[] = [];
  // Split before every level-2 heading; the first chunk is the title and intro.
  for (const section of text.split(/\n(?=## )/u)) {
    const heading = /^## (.*)$/u.exec(section.split("\n")[0] ?? "");
    if (heading !== null && DROPPED_SECTIONS.some((pattern) => pattern.test(heading[1] ?? ""))) continue;
    const blocks = section
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter((block) => block !== "");
    const kept: string[] = [];
    for (const block of blocks) {
      // A one-line heading is kept as it is; only body text is filtered.
      if (/^#{1,6} /u.test(block) && !block.includes("\n")) {
        kept.push(block);
        continue;
      }
      const filtered = filterBlock(block);
      if (filtered !== null) kept.push(filtered);
    }
    sections.push(kept.join("\n\n"));
  }
  const rules = sections.filter((section) => section !== "").join("\n\n");
  if (FORBIDDEN.test(rules)) {
    throw new Error("the night rules derived from AGENTS.md still name a secrets folder or a local path; update project-rules.ts before running");
  }
  return `${rules}\n`;
}
