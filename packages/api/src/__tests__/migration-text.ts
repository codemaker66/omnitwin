import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "vitest";

// Read a migration without naming its number.
//
// The captain allocates migration numbers and may renumber at merge, so a test
// that opens "0073_catalogue_reconcile.sql" turns a clerical decision into a
// red suite. Every migration here is found through the journal by the stable
// half of its tag instead. Resolving it that way also asserts the thing a
// migration test most needs to know and would otherwise never check: that the
// file is journaled at all. An unjournaled migration never runs.

interface JournalEntry {
  readonly tag: string;
}

/** The single journal tag ending in `suffix`. Fails if absent or ambiguous. */
export async function tagEndingWith(suffix: string): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8"));
  const entries = (raw as { entries?: readonly JournalEntry[] }).entries ?? [];
  const matches = entries.filter((entry) => entry.tag.endsWith(suffix));
  expect(matches.map((entry) => entry.tag), `exactly one journal entry should end with ${suffix}`)
    .toHaveLength(1);
  return matches[0]?.tag ?? "";
}

/** The SQL of the journaled migration whose tag ends in `suffix`. */
export async function migrationText(suffix: string): Promise<string> {
  return readFile(resolve("drizzle", `${await tagEndingWith(suffix)}.sql`), "utf8");
}

/**
 * The migration with its `--` comments removed, quote-aware.
 *
 * Structural assertions must read the code, not the prose around it. These
 * files explain themselves at length — one header quotes `DROP CONSTRAINT IF
 * EXISTS` while arguing about it, another says a predicate is "not derived
 * from everything not in the rules" — and a test that greps the raw text
 * cannot tell an explanation from a statement. Both of those produced a false
 * failure before this existed.
 */
export function sqlWithoutComments(sql: string): string {
  return sql.split("\n").map((line) => {
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "'") { quoted = !quoted; continue; }
      if (!quoted && line[index] === "-" && line[index + 1] === "-") return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

/**
 * The quoted values inside the first `IN ('a', 'b', …)` list that follows a
 * named constraint, in written order.
 */
export function checkListValues(sql: string, constraintName: string): string[] {
  const pattern = new RegExp(`"${constraintName}"[\\s\\S]{0,200}?IN \\(([^)]*)\\)`, "u");
  const body = pattern.exec(sql)?.[1];
  expect(body, `${constraintName} should declare an IN list`).toBeDefined();
  return [...(body ?? "").matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? "");
}
