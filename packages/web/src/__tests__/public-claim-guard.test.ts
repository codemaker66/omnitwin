import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYED_PRIVATE_BRIEF = path.resolve(
  "public/private/brief/trades-hall-2026-04-27/index.html",
);

const VERCEL_CONFIG = path.resolve("vercel.json");

const SCAN_ROOTS: readonly string[] = [
  "public",
  "src/pages",
  "src/components/auth",
  "src/components/dashboard",
  "src/components/editor",
  "src/components/hallkeeper",
  "src/components/shared",
  "src/components/truth",
  "src/router.tsx",
  "src/App.tsx",
  "src/lib/editor-save-status.ts",
  "src/lib/layout-capacity.ts",
  "src/lib/runtime-package-resolution.ts",
  "src/lib/truth-mode-summary.ts",
  "index.html",
  "../../README.md",
  "../api/emails",
  "../api/src/services/email-templates.tsx",
  "../api/src/services/hallkeeper-pdf-v2.ts",
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
]);

const SKIPPED_PATH_PARTS = new Set([
  "__tests__",
  "node_modules",
  "playwright-report",
  "test-results",
]);

interface ClaimPattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly guidance: string;
}

interface ClaimAllowlistEntry {
  readonly file: string;
  readonly patternId: string;
  readonly contains: string;
  readonly owner: string;
  readonly reason: string;
  readonly expiresOn: string;
}

// This targeted deployment guard intentionally covers the highest-risk phrases
// that have already escaped or nearly escaped into public assets. The canonical
// forbidden/evidence-required taxonomy lives in:
// - docs/architecture/claim-aware-copy-guard.md
// - docs/architecture/layout-proof-object.md
const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "black-label",
    pattern: /\bBlack Label\b/giu,
    guidance: "Public Black Label copy requires current capture-certification evidence.",
  },
  {
    id: "survey-grade",
    pattern: /\bsurvey(?:or)?[- ]grade\b/giu,
    guidance: "Survey-grade wording requires professional survey evidence and scoped tolerance.",
  },
  {
    id: "photoreal-strong",
    pattern: /\b(?:photoreal digital twin|photorealistic 3D walkthroughs included|photoreal venue twin)\b/giu,
    guidance: "Photoreal public copy requires real T-091-style runtime evidence for the exact venue.",
  },
  {
    id: "laser-survey",
    pattern: /\blaser[- ]survey accuracy\b/giu,
    guidance: "Laser-survey accuracy cannot be claimed without qualified measured provenance.",
  },
  {
    id: "cinema-grade",
    pattern: /\bcinema[- ]grade fidelity\b/giu,
    guidance: "Cinema-grade visual claims need current visual QA evidence.",
  },
  {
    id: "compliance-certified",
    pattern: /\b(?:certified compliant|legally compliant|certified safe|production ready)\b/giu,
    guidance: "Legal/safety/production certification claims require explicit reviewed evidence.",
  },
  {
    id: "fire-egress-certified",
    pattern: /\b(?:fire approved|regulator approved|evacuation certified|approved for occupancy)\b/giu,
    guidance: "Fire, regulator, evacuation, and occupancy approval wording is forbidden without authority evidence.",
  },
  {
    id: "accessibility-guarantee",
    pattern: /\bguaranteed accessible\b/giu,
    guidance: "Accessibility guarantees require a scoped accessibility review and should not be absolute.",
  },
  {
    id: "unsupported-review-evidence",
    pattern: /\b(?:independent reviewers|clinical study|4\.6 or higher)\b/giu,
    guidance: "Do not imply third-party review, study evidence, or ratings before those records exist.",
  },
  {
    id: "real-room-runtime-claim",
    pattern: /\b(?:inside the real|real Grand Hall|Real \{selectedRoom\.shortTitle\}|Every room in 3D|Interactive 3D planning walkthroughs included)\b/giu,
    guidance: "Real-room runtime claims require a real loaded runtime asset with evidence.",
  },
  {
    id: "stale-onboard-query-link",
    pattern: /\/onboard\?/giu,
    guidance: "Public CTAs must use the current register/onboard route semantics, not stale query links.",
  },
];

const CLAIM_ALLOWLIST: readonly ClaimAllowlistEntry[] = [];

function pathParts(file: string): readonly string[] {
  return file.split(/[\\/]+/u);
}

function isSkippedPath(file: string): boolean {
  const parts = pathParts(file);
  if (parts.some((part) => SKIPPED_PATH_PARTS.has(part))) return true;
  return /\.test\.[cm]?[jt]sx?$/iu.test(file) || /\.spec\.[cm]?[jt]sx?$/iu.test(file);
}

async function collectTextFiles(target: string): Promise<readonly string[]> {
  if (!existsSync(target)) return [];

  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    if (isSkippedPath(target)) return [];
    if (!TEXT_EXTENSIONS.has(path.extname(target).toLowerCase())) return [];
    return [target];
  }

  const entries = await readdir(target);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(target, entry);
      if (isSkippedPath(fullPath)) return [];
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) return collectTextFiles(fullPath);
      if (!TEXT_EXTENSIONS.has(path.extname(entry).toLowerCase())) return [];
      return [fullPath];
    }),
  );

  return files.flat();
}

async function readPublicSurfaceFiles(): Promise<readonly { readonly file: string; readonly text: string }[]> {
  const files = await Promise.all(
    SCAN_ROOTS.map((scanRoot) => collectTextFiles(path.resolve(scanRoot))),
  );
  const uniqueFiles = Array.from(new Set(files.flat()));

  return Promise.all(
    uniqueFiles.map(async (file) => ({
      file: path.relative(process.cwd(), file),
      text: normaliseScannedText(file, await readFile(file, "utf-8")),
    })),
  );
}

function normaliseScannedText(file: string, text: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".ts" && ext !== ".tsx" && ext !== ".js") return text;
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "");
}

function isAllowlisted(file: string, patternId: string, matchText: string): boolean {
  return CLAIM_ALLOWLIST.some((entry) =>
    entry.file === file &&
    entry.patternId === patternId &&
    matchText.includes(entry.contains),
  );
}

function assertValidAllowlistEntry(entry: ClaimAllowlistEntry): void {
  const expiry = Date.parse(entry.expiresOn);
  expect(Number.isFinite(expiry), `${entry.file} ${entry.patternId} has an invalid expiry`).toBe(true);
  expect(entry.owner.trim(), `${entry.file} ${entry.patternId} needs an owner`).not.toBe("");
  expect(entry.reason.trim(), `${entry.file} ${entry.patternId} needs a reason`).not.toBe("");
  expect(entry.contains.trim(), `${entry.file} ${entry.patternId} needs a match substring`).not.toBe("");

  const today = Date.UTC(2026, 5, 7);
  expect(expiry, `${entry.file} ${entry.patternId} allowlist expired`).toBeGreaterThanOrEqual(today);
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

  it("keeps claim-lint allowlist entries explicit, owned, and unexpired", () => {
    for (const entry of CLAIM_ALLOWLIST) {
      assertValidAllowlistEntry(entry);
    }
  });

  it("scans deployable and customer-facing surfaces for unsupported claim phrases", async () => {
    const files = await readPublicSurfaceFiles();
    const violations = files.flatMap(({ file, text }) =>
      CLAIM_PATTERNS.flatMap((claimPattern) => {
        const matches = Array.from(text.matchAll(claimPattern.pattern));
        return matches.flatMap((match) => {
          const matchText = match[0];
          if (matchText === undefined || isAllowlisted(file, claimPattern.id, matchText)) return [];
          return [`${file}: ${claimPattern.id}: ${matchText} — ${claimPattern.guidance}`];
        });
      }),
    );

    expect(violations).toEqual([]);
  });
});
