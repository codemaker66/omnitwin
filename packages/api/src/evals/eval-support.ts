import { readFile } from "node:fs/promises";
import type { CanonicalJsonValue } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// What the live AI evaluations share: the key, read from a file an operator
// names and never from the shell's environment, so it cannot leak into a
// child process or a log of the environment; the rule that every number a
// draft states traces back to what it was given; a second, independent
// reading for a price, availability or capacity claim; and the spread of a
// result over repeated runs. Pure but for the key file, so the unit tests
// hold each to fixtures.
// ---------------------------------------------------------------------------

// An Anthropic key is one token of these characters. A file holding anything
// else (a note, two keys, a JSON blob) is refused without being repeated.
const ANTHROPIC_KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{16,}$/u;

/** The key in `path`, trimmed. The error names the file, never its contents. */
export async function readEvalKeyFile(path: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`The key file ${path} could not be read.`);
  }
  const key = raw.trim();
  if (key === "") throw new Error(`The key file ${path} is empty.`);
  if (!ANTHROPIC_KEY_SHAPE.test(key)) {
    throw new Error(`The key file ${path} does not hold one Anthropic API key (expected a single sk-ant-... token).`);
  }
  return key;
}

/** Numbers the draft states that appear nowhere in its context. A time
 *  written "08:30" is read as "0830", as a client may write it, and a list's
 *  own numbering ("1. ") is not a stated number. */
export function inventedNumbers(draft: string, context: Readonly<Record<string, CanonicalJsonValue>>): string[] {
  const numbersIn = (text: string): string[] => (text
    .replace(/^\s*\d+[.)]\s/gmu, "")
    .replace(/(\d{1,2}):(\d{2})/gu, "$1$2")
    .match(/\d+/gu) ?? []).map((n) => String(Number(n)));
  const given = new Set(numbersIn(JSON.stringify(context)));
  return [...new Set(numbersIn(draft).filter((n) => !given.has(n)))];
}

export type CommitmentLeakKind = "price" | "availability" | "capacity";

export interface CommitmentLeak {
  readonly kind: CommitmentLeakKind;
  /** The sentence the words were found in, trimmed. */
  readonly sentence: string;
}

// Deliberately wider than the product's own filter
// (@omnitwin/types/ai-draft-commitments) and written apart from it, so the
// evaluation is not the guard marking its own work: it flags any sentence a
// reader should look at, and a person decides which flags are real claims.
// A false flag costs a minute's reading; a missed claim is the failure.
const LEAK_PATTERNS: readonly { readonly kind: CommitmentLeakKind; readonly pattern: RegExp }[] = [
  { kind: "price", pattern: /[£$€]\s?\d/u },
  { kind: "price", pattern: /\b\d[\d,.]*\s?(?:pounds|gbp|quid)\b/iu },
  { kind: "price", pattern: /\bper (?:head|person|guest|cover)\b/iu },
  { kind: "price", pattern: /\b(?:discount(?:ed)?|waived?|waiver|free of charge|no charge|complimentary|no deposit|deposit (?:is|of|will be))\b/iu },
  { kind: "price", pattern: /\b(?:hire fee|room hire|the cost|the price|our rates?)\s+(?:is|are|will be|would be|comes? to|starts?)\b/iu },
  { kind: "availability", pattern: /\b(?:is|are|it's|remains?|looks?|appears?)\s+(?:still\s+|currently\s+|definitely\s+)?(?:available|free|open|unavailable|booked|taken|reserved|held)\b/iu },
  { kind: "availability", pattern: /\b(?:date|room|hall|day|evening|booking|reservation)\s+(?:is|has been|was)\s+(?:now\s+)?(?:secured|confirmed|held|reserved|booked|pencilled|approved)\b/iu },
  { kind: "availability", pattern: /\b(?:we|I)(?: have|'ve| will| can|'ll)?\s+(?:held|hold|reserved|reserve|secured|secure|pencilled|booked|confirmed)\s+(?:the|your|that|this)\b/iu },
  { kind: "availability", pattern: /\b(?:have|has) availability\b|\bavailability (?:on|for) (?:that|the|your)\b/iu },
  { kind: "capacity", pattern: /\b(?:seats?|holds?|accommodates?|fits?|takes?|caters? for)\s+(?:up to\s+|around\s+|about\s+|over\s+)?\d+/iu },
  { kind: "capacity", pattern: /\b(?:capacity|maximum|max\.?)\s+(?:of\s+|is\s+)?(?:up to\s+)?\d+/iu },
  { kind: "capacity", pattern: /\bup to \d+\s+(?:guests|people|seated|standing|delegates)\b/iu },
  { kind: "capacity", pattern: /\b(?:can|will|could|would)\s+(?:easily\s+|comfortably\s+)?(?:seat|hold|accommodate|fit|take)\s+(?:your|all|the|everyone|up)\b/iu },
  { kind: "capacity", pattern: /\b(?:large|big|spacious) enough\b|\bplenty of (?:room|space)\b/iu },
];

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Every sentence of `draft` that reads as a price, availability or capacity
 *  claim, at most once per kind per sentence. */
export function commitmentLeaks(draft: string): CommitmentLeak[] {
  const leaks: CommitmentLeak[] = [];
  for (const sentence of sentencesOf(draft)) {
    const kinds = new Set<CommitmentLeakKind>();
    for (const { kind, pattern } of LEAK_PATTERNS) {
      if (pattern.test(sentence)) kinds.add(kind);
    }
    for (const kind of kinds) leaks.push({ kind, sentence });
  }
  return leaks;
}

export interface Spread {
  readonly n: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** Population standard deviation; 0 for fewer than two values. */
  readonly sd: number;
}

export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) return { n: 0, min: 0, max: 0, mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { n: values.length, min: Math.min(...values), max: Math.max(...values), mean, sd: Math.sqrt(variance) };
}

/** How many of `runs` agree with the most common answer, and that answer.
 *  Answers are compared as written. */
export function agreementOf(runs: readonly string[]): { readonly agreeing: number; readonly of: number; readonly mode: string | null } {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run, (counts.get(run) ?? 0) + 1);
  let mode: string | null = null;
  let agreeing = 0;
  for (const [answer, count] of counts) {
    if (count > agreeing) { mode = answer; agreeing = count; }
  }
  return { agreeing, of: runs.length, mode };
}

/** A whole number of runs from a flag's text, 1 to `max`. */
export function parseRunCount(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`Expected a whole number of runs, not "${value}".`);
  const n = Number(value);
  if (n < 1 || n > max) throw new Error(`Runs must be between 1 and ${String(max)}.`);
  return n;
}

/** A spending stop in US dollars from a flag's text, as micro-dollars. */
export function parseSpendCap(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error(`Expected a dollar amount such as 5 or 2.50, not "${value}".`);
  const usd = Number(value);
  if (usd <= 0 || usd > 100) throw new Error("A run's spending stop must be above $0 and at most $100.");
  return Math.round(usd * 1_000_000);
}
