import { TextDecoder } from "node:util";

const MAX_JSON_DEPTH = 128;

export class GrandHallT554StrictJsonError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554StrictJsonError";
  }
}

const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class StrictJsonLexicalParser {
  private index = 0;

  constructor(private readonly text: string) {}

  parse(): void {
    this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("Trailing JSON data");
  }

  private fail(message: string): never {
    throw new GrandHallT554StrictJsonError(
      `${message} at character ${String(this.index)}.`,
    );
  }

  private skipWhitespace(): void {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\t" ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r"
    ) this.index += 1;
  }

  private parseString(): string {
    if (this.text[this.index] !== '"') return this.fail("Invalid JSON string token");
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') return this.finishString(start);
      if (character === "\\") {
        this.parseEscape();
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        return this.fail("Unescaped JSON control character");
      }
      this.index += 1;
    }
    return this.fail("Unterminated JSON string");
  }

  private finishString(start: number): string {
    this.index += 1;
    try {
      const value: unknown = JSON.parse(this.text.slice(start, this.index));
      return typeof value === "string" ? value : this.fail("Invalid JSON string value");
    } catch (error) {
      if (error instanceof GrandHallT554StrictJsonError) throw error;
      return this.fail("Invalid escaped JSON string");
    }
  }

  private parseEscape(): void {
    this.index += 1;
    const escape = this.text[this.index];
    if (escape === "u") {
      if (!/^[a-fA-F0-9]{4}$/u.test(this.text.slice(this.index + 1, this.index + 5))) {
        return this.fail("Invalid JSON unicode escape");
      }
      this.index += 5;
      return;
    }
    if (escape === undefined || !/^["\\/bfnrt]$/u.test(escape)) {
      return this.fail("Invalid JSON escape");
    }
    this.index += 1;
  }

  private parseNumber(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.text.slice(this.index),
    );
    if (match === null) return this.fail("Invalid JSON number");
    this.index += match[0].length;
  }

  private parseValue(depth: number): void {
    if (depth > MAX_JSON_DEPTH) return this.fail("JSON nesting is too deep");
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") {
      this.parseObject(depth);
      return;
    }
    if (character === "[") {
      this.parseArray(depth);
      return;
    }
    if (character === '"') {
      this.parseString();
      return;
    }
    if (character === "-" || (character !== undefined && /^[0-9]$/u.test(character))) {
      this.parseNumber();
      return;
    }
    this.parseLiteral();
  }

  private parseObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.parseString();
      if (keys.has(key)) this.fail(`Duplicate JSON object key ${JSON.stringify(key)}`);
      if (PROHIBITED_JSON_KEYS.has(key)) {
        this.fail(`Prohibited JSON object key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("Missing colon after JSON object key");
      this.index += 1;
      this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return;
      }
      if (this.text[this.index] !== ",") this.fail("Missing comma between JSON object members");
      this.index += 1;
    }
  }

  private parseArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return;
    }
    for (;;) {
      this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return;
      }
      if (this.text[this.index] !== ",") this.fail("Missing comma between JSON array elements");
      this.index += 1;
    }
  }

  private parseLiteral(): void {
    for (const literal of ["true", "false", "null"] as const) {
      if (this.text.startsWith(literal, this.index)) {
        this.index += literal.length;
        return;
      }
    }
    this.fail("Invalid JSON value");
  }
}

function validateJsonLexically(text: string): void {
  new StrictJsonLexicalParser(text).parse();
}

export function parseGrandHallT554StrictJson(bytes: Buffer): unknown {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new GrandHallT554StrictJsonError("UTF-8 BOM is forbidden");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new GrandHallT554StrictJsonError("Document must be valid UTF-8", error);
  }
  validateJsonLexically(text);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new GrandHallT554StrictJsonError("Document must be valid JSON", error);
  }
}
