import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYED_PRIVATE_BRIEF = path.resolve(
  "public/private/brief/trades-hall-2026-04-27/index.html",
);

const VERCEL_CONFIG = path.resolve("vercel.json");

const PUBLIC_STATIC_ROOT = path.resolve("public");

const PUBLIC_SOURCE_FILES: readonly string[] = [
  path.resolve("src/pages/LandingPage.tsx"),
  path.resolve("src/pages/PricingPage.tsx"),
  path.resolve("../../README.md"),
];

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".svg", ".txt"]);

// This targeted deployment guard intentionally covers the highest-risk phrases
// that have already escaped or nearly escaped into public assets. The canonical
// forbidden/evidence-required taxonomy lives in:
// - docs/architecture/claim-aware-copy-guard.md
// - docs/architecture/layout-proof-object.md
// T-200 tracks turning that doctrine into a broader production scanner.
const BANNED_PUBLIC_CLAIMS: readonly RegExp[] = [
  /\bBlack Label\b/i,
  /\bsurveyor-grade\b/i,
  /\bsurvey grade\b/i,
  /\bphotoreal digital twin\b/i,
  /\bphotorealistic 3D walkthroughs included\b/i,
  /\blaser-survey accuracy\b/i,
  /\bcinema-grade fidelity\b/i,
  /\bcertified compliant\b/i,
  /\blegally compliant\b/i,
  /\bfire approved\b/i,
  /\bregulator approved\b/i,
  /\bevacuation certified\b/i,
  /\bguaranteed accessible\b/i,
  /\bapproved for occupancy\b/i,
  /\bindependent reviewers\b/i,
  /\bclinical study\b/i,
  /\b4\.6 or higher\b/i,
];

async function collectTextFiles(directory: string): Promise<readonly string[]> {
  if (!existsSync(directory)) return [];

  const entries = await readdir(directory);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry);
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) return collectTextFiles(fullPath);
      if (!TEXT_EXTENSIONS.has(path.extname(entry).toLowerCase())) return [];
      return [fullPath];
    }),
  );

  return files.flat();
}

async function readPublicSurfaceFiles(): Promise<readonly { readonly file: string; readonly text: string }[]> {
  const staticFiles = await collectTextFiles(PUBLIC_STATIC_ROOT);
  const candidateFiles = [...staticFiles, ...PUBLIC_SOURCE_FILES].filter((file) => existsSync(file));

  return Promise.all(
    candidateFiles.map(async (file) => ({
      file: path.relative(process.cwd(), file),
      text: await readFile(file, "utf-8"),
    })),
  );
}

describe("public claim guard", () => {
  it("keeps the 2026 Trades Hall private brief out of deployed public assets", () => {
    expect(existsSync(DEPLOYED_PRIVATE_BRIEF)).toBe(false);
  });

  it("does not rewrite the private brief route to a deployable static artifact", async () => {
    const config = await readFile(VERCEL_CONFIG, "utf-8");

    expect(config).toMatch(
      /"source"\s*:\s*"\/private\/brief\/trades-hall-2026-04-27\/?"\s*,\s*"destination"\s*:\s*"\/"/u,
    );
    expect(config).not.toMatch(
      /"rewrites"\s*:\s*\[[\s\S]*"source"\s*:\s*"\/private\/brief\/trades-hall-2026-04-27\/?"/u,
    );
    expect(config).not.toContain("/private/brief/trades-hall-2026-04-27/index.html");
  });

  it("does not ship unsupported private-brief claim phrases on public surfaces", async () => {
    const files = await readPublicSurfaceFiles();
    const violations = files.flatMap(({ file, text }) =>
      BANNED_PUBLIC_CLAIMS.flatMap((pattern) => {
        const match = text.match(pattern);
        return match === null ? [] : [`${file}: ${match[0]}`];
      }),
    );

    expect(violations).toEqual([]);
  });
});
