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
  // T-648: the shared Martyn's Law wording the sheet, print and PDF all draw.
  "../types/src/protected-premises.ts",
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
  {
    // T-648: the Martyn's Law readiness section prompts; it never claims.
    // docs/engineering/martyns-law-readiness.md holds the rule and sources.
    id: "martyns-law-claim",
    pattern: /\b(?:Martyn[’']s Law[- ](?:compliant|approved|certified|ready)\b|(?:compliant|complies) with (?:Martyn[’']s Law|the Act)|(?:meets|satisfies|fulfils) (?:Martyn[’']s Law|the Act|the (?:standard|enhanced) (?:tier|duty))|SIA[- ](?:approved|certified|accredited)|protected premises (?:compliant|approved|certified)|(?:terror(?:ism)?|attack)[- ]proof|(?:standard|enhanced)[- ]tier (?:applies|confirmed|met)|(?:this|the) event (?:triggers|is in scope|is a qualifying event|qualifies)|in scope of (?:Martyn[’']s Law|the Act))/giu,
    guidance: "Martyn's Law copy gives prompts only: never claim or imply compliance, approval, certification, safety or a tier determination. The venue's responsible person decides.",
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

  it("recognises Martyn's Law claim wording and passes the readiness prompts (T-648)", () => {
    const pattern = CLAIM_PATTERNS.find((entry) => entry.id === "martyns-law-claim")?.pattern;
    if (pattern === undefined) throw new Error("martyns-law-claim pattern missing");
    const matches = (text: string): boolean => { pattern.lastIndex = 0; return pattern.test(text); };
    for (const claim of [
      "This venue is Martyn's Law compliant",
      "Martyn’s Law ready",
      "The event complies with the Act",
      "Meets the enhanced tier",
      "SIA approved security",
      "Enhanced tier applies",
      "This event triggers the enhanced duty",
      "The event qualifies",
      "Venue in scope of Martyn's Law",
    ]) {
      expect(matches(claim), claim).toBe(true);
    }
    for (const prompt of [
      "Martyn's Law readiness",
      "Prompts only, from what has been entered for this event.",
      "The venue's responsible person decides what applies.",
      "A public event with entry checks where 800 or more may be present can be a qualifying event.",
      "Not checked",
    ]) {
      expect(matches(prompt), prompt).toBe(false);
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

// ---------------------------------------------------------------------------
// Banned verdicts (redteam fix-first 2). A structural, electrical, egress or
// occupancy question is never answered "within", "fits", "pass", "valid" or
// "compliant": no named person checked the point's WLL, the room's supply, its
// doors or its maximum, so the planner states arithmetic, the venue's
// published figure with who stated it, or "Not recorded" with a person to ask.
// England's Approved Document B, the US NFPA 101 and an unverified BS 9999
// table are not evidence for a Glasgow building and are not quoted at all.
// The rendered side of this guard (every safety lens, every viewer) lives in
// components/editor/cockpit/__tests__/banned-verdicts.test.tsx.
// ---------------------------------------------------------------------------

/** Planner surfaces that answer those questions, and the libraries that write their words. */
const PLANNER_VERDICT_ROOTS: readonly string[] = [
  "src/components/editor",
  "src/hooks/use-planner-truth.ts",
  "src/lib/circulation.ts",
  "src/lib/cockpit-cost-model.ts",
  "src/lib/cockpit-evidence-model.ts",
  "src/lib/cockpit-flow-panel-model.ts",
  "src/lib/cockpit-guests-model.ts",
  "src/lib/cockpit-share-model.ts",
  "src/lib/dmx.ts",
  "src/lib/layout-capacity.ts",
  "src/lib/layout-intelligence.ts",
  "src/lib/planner-truth.ts",
  "src/lib/power.ts",
  "src/lib/proposal-capacity-note.ts",
  "src/lib/rigging.ts",
  "src/lib/room-capacity.ts",
  "src/lib/unrecorded-ask.ts",
  "../types/src/solver/compliance.ts",
];

const VERDICT_WORD = String.raw`(?:within|fits?|pass(?:es|ed)?|valid|compliant)`;
const SAFETY_SUBJECT = String.raw`(?:WLL|working load(?: limit)?|load limit|breakers?|(?:power )?supply|circuits?|phases?|egress|exits?|escape(?: routes?)?|fire|travel distance|occupan(?:cy|ts?)|capacity|headcount|(?:planning )?guidance|rigging|structur\w*|evacuation|aisles?)`;

const BANNED_VERDICT_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "verdict-on-safety-subject",
    pattern: new RegExp(String.raw`\b${VERDICT_WORD}\b(?:[ \t]+[\w'’-]+){0,4}?[ \t]+${SAFETY_SUBJECT}\b`, "giu"),
    guidance: "Never answer a structural, electrical, egress or occupancy question with within/fits/pass/valid/compliant: state the arithmetic, the published figure and its source, or \"Not recorded\" with a person to ask.",
  },
  {
    id: "safety-subject-verdict",
    pattern: new RegExp(String.raw`\b${SAFETY_SUBJECT}\b(?:[ \t]+[\w'’-]+){0,3}?[ \t]+${VERDICT_WORD}\b`, "giu"),
    guidance: "A capacity, supply, WLL or exit is never said to be within or passing anything nobody checked.",
  },
  {
    id: "verdict-label",
    pattern: /["'`>]\s*(?:Pass(?:ed)?|Fits?|Valid|Compliant|Within(?: [A-Z][\w ]{0,30})?)\s*["'`<]/gu,
    guidance: "No Pass / Within / Fits / Valid / Compliant chip on a planner surface: a tick is only honest for something a named person checked.",
  },
  {
    id: "wrong-jurisdiction-code",
    pattern: /\b(?:Approved Document B|ADB|NFPA(?: 101)?|BS 9999)\b/gu,
    guidance: "England's ADB, the US NFPA 101 and an unverified BS 9999 table are not evidence for a Glasgow building; the venue's fire risk assessment is.",
  },
];

function bannedVerdictPattern(id: string): RegExp {
  const pattern = BANNED_VERDICT_PATTERNS.find((entry) => entry.id === id)?.pattern;
  if (pattern === undefined) throw new Error(`${id} pattern missing`);
  return pattern;
}

function hits(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

async function readPlannerVerdictFiles(): Promise<readonly { readonly file: string; readonly text: string }[]> {
  const files = await Promise.all(PLANNER_VERDICT_ROOTS.map((root) => collectTextFiles(path.resolve(root))));
  return Promise.all(
    Array.from(new Set(files.flat())).map(async (file) => ({
      file: path.relative(process.cwd(), file),
      text: normaliseScannedText(file, await readFile(file, "utf-8")),
    })),
  );
}

describe("banned safety verdicts on planner surfaces (redteam fix-first 2)", () => {
  it("recognises the verdicts the planner used to show, and passes what it says now", () => {
    const verdicts: readonly (readonly [string, string])[] = [
      ["verdict-label", `<span>{"Within WLL"}</span>`],
      ["verdict-label", `pass: "Pass",`],
      ["verdict-label", `<span className="chip">Fits</span>`],
      ["verdict-on-safety-subject", "Comfortable — within planning guidance"],
      ["verdict-on-safety-subject", "The load is within the point's working load limit"],
      ["verdict-on-safety-subject", "160 guests fits the room's capacity"],
      ["verdict-on-safety-subject", "Layout passes egress"],
      ["safety-subject-verdict", "capacity within guidance"],
      ["safety-subject-verdict", "Phase L1 within the breaker"],
      ["safety-subject-verdict", "Exits compliant"],
      ["wrong-jurisdiction-code", "ADB guidance indicates ≥ 2 escape routes"],
      ["wrong-jurisdiction-code", "(BS 9999:2017 Table 12)"],
      ["wrong-jurisdiction-code", "NFPA 101 occupant load factor"],
    ];
    for (const [id, text] of verdicts) expect(hits(bannedVerdictPattern(id), text), `${id}: ${text}`).toBe(true);

    const honest = [
      "Not recorded",
      "Ask the hallkeeper",
      "Over the WLL entered",
      "Entered here in this plan; not a check of the point.",
      "Published 180 for dinner.",
      "200 guests is more than the published 180 for dinner.",
      "Published guide · Trades Hall · 9 Jul 2026",
      "At or above generic space per guest",
      "Escape routes and maximum",
      "is beyond the 18m planning distance setting",
      "Ask us for a quote",
    ];
    for (const text of honest) {
      for (const entry of BANNED_VERDICT_PATTERNS) expect(hits(entry.pattern, text), `${entry.id}: ${text}`).toBe(false);
    }
  });

  it("finds no verdict on a structural, electrical, egress or occupancy question in planner source", async () => {
    const files = await readPlannerVerdictFiles();
    expect(files.length).toBeGreaterThan(50);
    const violations = files.flatMap(({ file, text }) =>
      BANNED_VERDICT_PATTERNS.flatMap((entry) =>
        Array.from(text.matchAll(entry.pattern)).flatMap((match) =>
          match[0] === undefined ? [] : [`${file}: ${entry.id}: ${match[0]} — ${entry.guidance}`]),
      ),
    );
    expect(violations).toEqual([]);
  });

  it("keeps the England and US egress arithmetic out of every planner surface", async () => {
    const files = await readPlannerVerdictFiles();
    const importers = files
      .filter(({ text }) => /from\s+["'][^"']*\/egress\.js["']/u.test(text))
      .map(({ file }) => file);
    expect(importers).toEqual([]);
  });
});
