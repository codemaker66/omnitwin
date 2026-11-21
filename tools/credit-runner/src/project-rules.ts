/**
 * The repository's rules for an unattended run, taken from AGENTS.md.
 *
 * On master CLAUDE.md is a one-line `@AGENTS.md` import, which headless runs do
 * not expand, so they used to get no project rules at all. AGENTS.md is written
 * for interactive sessions: it points at the local credentials folder, asks for
 * deployment and live checks, and tells sessions to update the task list and the
 * day's session log. Those parts are removed here rather than contradicted by an
 * override, so an unattended agent is never told where secrets live.
 */

/** Level-2 sections that only an interactive session can act on. */
const DROPPED_SECTIONS: readonly RegExp[] = [/^Local CMS credentials\b/iu, /^Current delivery instruction\b/iu];

/**
 * Paragraphs (or list items) that point an unattended run at secrets, at files
 * the day's sessions own, or at a person to ask.
 */
const DROPPED_PARAGRAPHS: readonly RegExp[] = [
  /deploy-secrets/iu,
  /docs\/sessions\//u,
  /docs\/state\/tasks\.md/u,
  /\bAsk only for a material decision\b/u,
];

const FORBIDDEN = /deploy-secrets/iu;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/u;

function keepParagraph(block: string): boolean {
  return !DROPPED_PARAGRAPHS.some((pattern) => pattern.test(block));
}

/** A list is filtered item by item, so one matching bullet does not take its neighbours with it. */
function filterBlock(block: string): string | null {
  const lines = block.split("\n");
  if (!LIST_ITEM.test(lines[0] ?? "")) return keepParagraph(block) ? block : null;
  const items: string[][] = [];
  for (const line of lines) {
    if (LIST_ITEM.test(line) || items.length === 0) items.push([line]);
    else items[items.length - 1]?.push(line);
  }
  const kept = items.map((item) => item.join("\n")).filter(keepParagraph);
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
    throw new Error("the night rules derived from AGENTS.md still name deploy-secrets; update project-rules.ts before running");
  }
  return `${rules}\n`;
}
