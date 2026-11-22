/**
 * A deliberately small reader for the YAML frontmatter at the top of a task file.
 *
 * Supported: `key: scalar` (quoted or plain strings, booleans, numbers), inline
 * lists (`key: [a, "b c"]`), block lists (`key:` followed by `  - item` lines),
 * full-line `#` comments, and trailing ` # comments` on unquoted values. Anything
 * else is rejected with its line number, so a typo can never be read silently as
 * a different value. Schema validation happens afterwards in task.ts.
 */

export type FrontmatterValue = string | number | boolean | readonly string[];

export interface FrontmatterDocument {
  readonly data: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
}

export class FrontmatterError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${String(line)}: ${message}`);
    this.name = "FrontmatterError";
    this.line = line;
  }
}

const KEY_LINE = /^([a-z_][a-z0-9_]*):(?:[ \t]+(.*))?$/u;
const BLOCK_ITEM = /^[ \t]+-[ \t]+(.*)$/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/u;

export function parseFrontmatter(text: string): FrontmatterDocument {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0] !== "---") {
    throw new FrontmatterError("a task file must start with a '---' frontmatter line", 1);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    throw new FrontmatterError("the frontmatter has no closing '---' line", lines.length);
  }

  const data: Record<string, FrontmatterValue> = {};
  let openList: string[] | null = null;

  for (let index = 1; index < end; index += 1) {
    const lineNo = index + 1;
    const line = lines[index] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const item = BLOCK_ITEM.exec(line);
    if (item !== null) {
      if (openList === null) {
        throw new FrontmatterError("a list item needs a 'key:' line with no value above it", lineNo);
      }
      openList.push(parseListItem(item[1] ?? "", lineNo));
      continue;
    }
    openList = null;

    const match = KEY_LINE.exec(line);
    if (match === null) {
      throw new FrontmatterError(`expected 'key: value', found ${JSON.stringify(line)}`, lineNo);
    }
    const key = match[1] ?? "";
    if (Object.hasOwn(data, key)) {
      throw new FrontmatterError(`'${key}' appears twice`, lineNo);
    }
    const raw = match[2]?.trim() ?? "";
    if (raw === "") {
      const items: string[] = [];
      data[key] = items;
      openList = items;
    } else {
      data[key] = parseScalarOrList(raw, lineNo);
    }
  }

  return { data, body: lines.slice(end + 1).join("\n").trim() };
}

function parseScalarOrList(raw: string, lineNo: number): FrontmatterValue {
  if (raw.startsWith("[")) {
    if (!raw.endsWith("]")) throw new FrontmatterError("an inline list must end with ']'", lineNo);
    return splitInlineList(raw.slice(1, -1), lineNo).map((part) => parseListItem(part, lineNo));
  }
  if (raw.startsWith('"') || raw.startsWith("'")) return parseQuoted(raw, lineNo);
  const value = stripComment(raw);
  if (value === "") throw new FrontmatterError("the value is empty", lineNo);
  if (value === "true") return true;
  if (value === "false") return false;
  if (NUMBER.test(value)) return Number(value);
  return value;
}

function parseListItem(raw: string, lineNo: number): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return parseQuoted(trimmed, lineNo);
  const value = stripComment(trimmed);
  if (value === "") throw new FrontmatterError("a list item is empty", lineNo);
  return value;
}

function parseQuoted(raw: string, lineNo: number): string {
  const quote = raw[0];
  const close = quote === '"' ? findClosingDoubleQuote(raw) : raw.indexOf("'", 1);
  if (close === -1) throw new FrontmatterError("a quoted value is missing its closing quote", lineNo);
  const rest = raw.slice(close + 1).trim();
  if (rest !== "" && !rest.startsWith("#")) {
    throw new FrontmatterError(`unexpected text after the closing quote: ${JSON.stringify(rest)}`, lineNo);
  }
  const literal = raw.slice(0, close + 1);
  if (quote === "'") return literal.slice(1, -1);
  try {
    const parsed: unknown = JSON.parse(literal);
    if (typeof parsed === "string") return parsed;
  } catch {
    // Reported by the error below.
  }
  throw new FrontmatterError(`invalid double-quoted string ${literal}`, lineNo);
}

function findClosingDoubleQuote(raw: string): number {
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      index += 1;
    } else if (raw[index] === '"') {
      return index;
    }
  }
  return -1;
}

/** Splits `a, "b, c", Bash(git log --format=%h,%s)` on top-level commas only. */
function splitInlineList(inner: string, lineNo: number): string[] {
  if (inner.trim() === "") return [];
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote !== null) {
      if (char === "\\" && quote === '"') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
  }
  if (quote !== null) throw new FrontmatterError("an inline list has an unclosed quote", lineNo);
  parts.push(inner.slice(start));
  return parts;
}

function stripComment(raw: string): string {
  const hash = raw.search(/\s#/u);
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}
