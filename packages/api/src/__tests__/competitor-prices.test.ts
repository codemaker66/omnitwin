import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Competitor prices are an interface only (Blake, 17 October 2026: a licensed
// provider, still being researched), and never an input to a price.
// ---------------------------------------------------------------------------

async function sources(dir: string): Promise<readonly (readonly [string, string])[]> {
  const out: (readonly [string, string])[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...await sources(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push([full, await readFile(full, "utf-8")]);
    }
  }
  return out;
}

describe("competitor prices", () => {
  it("ship as types alone: no implementation, nothing that fetches or scrapes", async () => {
    const module: Record<string, unknown> = await import("../services/competitor-prices.js");
    expect(Object.keys(module)).toEqual([]);
    const text = await readFile(resolve("src/services/competitor-prices.ts"), "utf-8");
    expect(text).not.toMatch(/\bfetch\(|https?:\/\/|import\s/u);
  });

  it("say in the code that they must never set a price automatically, and why", async () => {
    const text = await readFile(resolve("src/services/competitor-prices.ts"), "utf-8");
    expect(text).toContain("MUST NEVER SET OR CHANGE A PRICE AUTOMATICALLY");
    expect(text).toContain("Competition and Markets Authority");
  });

  it("are read by no route, job or suggestion", async () => {
    const readers = (await sources(resolve("src")))
      .filter(([, text]) => /from\s+["'][^"']*competitor-prices(\.js)?["']/u.test(text))
      .map(([path]) => path);
    expect(readers).toEqual([]);
  });
});
