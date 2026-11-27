import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The guards on PostgreSQL test targets.
//
// Every PostgreSQL suite here checks its target before it connects: the
// address must be loopback and the database one made for that suite, so a
// slip of an environment variable cannot aim a test at a shared or production
// database. Reading the address's host is not enough. A PostgreSQL client
// takes its host and port from the query string when one is given, so
// postgresql://postgres@127.0.0.1/name?host=db.example.invalid passes a host
// check and connects somewhere else (review of #392, 11 November 2026). So a
// guard also requires an empty query string and fragment, and a postgres
// scheme. This holds every guard in the folder to that, the ones written
// after today included.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const THIS_FILE = "postgres-test-target-guards.test.ts";

/** Loopback to the eye, another server to the client. */
const LOOKS_LOCAL = "postgresql://postgres@127.0.0.1:55477/venviewer_inventory_ci?host=db.example.invalid&port=5432";

interface Guard {
  readonly file: string;
  /** The lines round one host check: the whole of a guard's condition. */
  readonly lines: string;
}

/**
 * Each place a suite that takes its database from the environment compares
 * the address's host. A guard's condition is a few lines long, so the lines
 * round the comparison hold all of it.
 */
function guards(): readonly Guard[] {
  const found: Guard[] = [];
  for (const file of readdirSync(HERE)) {
    if (!/\.test\.tsx?$/u.test(file) || file === THIS_FILE) continue;
    const source = readFileSync(join(HERE, file), "utf8");
    if (!/process\.env\[?["'.]?[A-Z_]*DATABASE_URL/u.test(source)) continue;
    const lines = source.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (!/\.hostname\b/u.test(line) || /^\s*(?:\/\/|\*)/u.test(line)) return;
      found.push({ file, lines: lines.slice(Math.max(0, index - 6), index + 9).join("\n") });
    });
  }
  return found;
}

describe("the guards on PostgreSQL test targets", () => {
  it("the reason: a client takes its host and port from the query string, over the address's own", () => {
    expect(new URL(LOOKS_LOCAL).hostname).toBe("127.0.0.1");
    const client = new Client({ connectionString: LOOKS_LOCAL });
    expect(client.host).toBe("db.example.invalid");
    expect(client.port).toBe(5432);
  });

  it("finds the suites it is meant to hold", () => {
    expect(new Set(guards().map((guard) => guard.file)).size).toBeGreaterThan(80);
  });

  it("every guard refuses a query string, a fragment, and a scheme that is not postgres", () => {
    const lacking = guards().flatMap(({ file, lines }) => {
      const missing = [
        /\.search\b/u.test(lines) ? null : "the query string",
        /\.hash\b/u.test(lines) ? null : "the fragment",
        /\.protocol\b/u.test(lines) ? null : "the scheme",
      ].filter((part): part is string => part !== null);
      return missing.length === 0 ? [] : [`${file}: does not check ${missing.join(", ")}`];
    });
    expect([...new Set(lacking)]).toEqual([]);
  });
});
