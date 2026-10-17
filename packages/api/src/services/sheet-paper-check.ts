import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  ConfigurationReviewStatusSchema,
  buildSheetPaperCheckUrl,
  isTerminalReviewStatus,
  isIssuedPaperQuery,
  paperFingerprint,
  type SheetPaperCheck,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { configurationSheetSnapshots, configurations } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Paper that knows its version (One Living Record, first slice).
//
// A printed hallkeeper sheet carries a QR code leading to a page anyone can
// open without signing in. This service answers that page with version state
// only — current, superseded (with the version to ask for), not approved,
// retired or unknown — never event, room, guest or contact content.
//
// It cannot be used to enumerate sheets: an issued copy is named by a random
// snapshot id AND a 64-bit fingerprint of that snapshot's source hash, and
// every failure (unknown id, wrong version, wrong fingerprint, deleted
// layout, damaged approval) gives the same "unknown". The public route adds
// a per-IP rate limit on top.
//
// Versions are per configuration (one room's layout). The answer is about
// "this room's sheet", not the whole event, until an event-level issue exists.
// ---------------------------------------------------------------------------

/**
 * A layout's sheet is retired only in a state the review machine never
 * leaves (archived after the event, or withdrawn). A rejected layout can
 * return to draft, so it is "not approved", never "closed".
 */
function isRetiredReviewStatus(reviewStatus: string): boolean {
  const parsed = ConfigurationReviewStatusSchema.safeParse(reviewStatus);
  return parsed.success && isTerminalReviewStatus(parsed.data);
}

const UNKNOWN: SheetPaperCheckResult = { state: "unknown" };

/** Everything the decision needs, read in one place so the rule is testable without a database. */
export interface SheetPaperFacts {
  /** What the paper claims: an issued version, or a working (unapproved) print. */
  readonly claim:
    | { readonly kind: "issued"; readonly snapshotId: string; readonly version: number; readonly fingerprint: string }
    | { readonly kind: "working" };
  /** The snapshot an issued copy names, as stored. Null when it does not exist. */
  readonly named: {
    readonly version: number;
    readonly sourceHash: string;
    readonly approvedAt: Date | null;
  } | null;
  /** The layout, unless it is unknown or deleted. */
  readonly config: { readonly reviewStatus: string; readonly approvedAt: Date | null } | null;
  /** The layout's newest approved snapshot, if any. */
  readonly latestApproved: { readonly id: string; readonly version: number; readonly approvedAt: Date } | null;
}

/**
 * The version in force for a layout, by the same rule the sheet itself is
 * served by (hallkeeper-sheet-v2-data.ts loadLatestApprovedSnapshot): the
 * layout is approved and its newest approved snapshot carries the layout's
 * own approval time. A mismatch is damaged evidence; it confirms nothing.
 */
function versionInForce(facts: SheetPaperFacts): { id: string; version: number } | "damaged" | null {
  const { config, latestApproved } = facts;
  if (config === null || config.reviewStatus !== "approved") return null;
  if (latestApproved === null || config.approvedAt === null
    || latestApproved.approvedAt.getTime() !== config.approvedAt.getTime()) {
    return "damaged";
  }
  return { id: latestApproved.id, version: latestApproved.version };
}

/** The whole rule. Pure. */
export function decideSheetPaperCheck(facts: SheetPaperFacts): SheetPaperCheckResult {
  if (facts.config === null) return UNKNOWN;
  const { claim } = facts;

  if (claim.kind === "issued") {
    // The named snapshot must exist, be an approved one, and match the
    // paper's version and fingerprint exactly. Anything else is not a copy
    // this system issued, and we say nothing more about it.
    const named = facts.named;
    if (named === null || named.approvedAt === null || named.version !== claim.version
      || paperFingerprint(named.sourceHash) !== claim.fingerprint) {
      return UNKNOWN;
    }
  }

  const inForce = versionInForce(facts);
  if (inForce === "damaged") return UNKNOWN;
  if (inForce !== null) {
    if (claim.kind === "working") return { state: "superseded", currentVersion: inForce.version };
    if (inForce.id === claim.snapshotId) return { state: "current", version: inForce.version };
    // Only a newer version can supersede a copy. An older "current" would
    // mean the record is inconsistent, and that is not a reason to say yes.
    return inForce.version > claim.version
      ? { state: "superseded", currentVersion: inForce.version }
      : UNKNOWN;
  }
  return isRetiredReviewStatus(facts.config.reviewStatus)
    ? { state: "retired" }
    : { state: "not_approved" };
}

/** Read the facts for one scanned link and decide. Three indexed reads at most. */
export async function resolveSheetPaperCheck(
  db: Database,
  query: SheetPaperCheckQuery,
): Promise<SheetPaperCheckResult> {
  let configId: string;
  let named: SheetPaperFacts["named"] = null;
  let claim: SheetPaperFacts["claim"];

  if (isIssuedPaperQuery(query)) {
    const [row] = await db.select({
      configurationId: configurationSheetSnapshots.configurationId,
      version: configurationSheetSnapshots.version,
      sourceHash: configurationSheetSnapshots.sourceHash,
      approvedAt: configurationSheetSnapshots.approvedAt,
    })
      .from(configurationSheetSnapshots)
      .where(eq(configurationSheetSnapshots.id, query.s))
      .limit(1);
    if (row === undefined) return UNKNOWN;
    configId = row.configurationId;
    named = { version: row.version, sourceHash: row.sourceHash, approvedAt: row.approvedAt };
    claim = { kind: "issued", snapshotId: query.s, version: query.v, fingerprint: query.h };
  } else {
    configId = query.c;
    claim = { kind: "working" };
  }

  const [config] = await db.select({
    reviewStatus: configurations.reviewStatus,
    approvedAt: configurations.approvedAt,
  })
    .from(configurations)
    .where(and(eq(configurations.id, configId), isNull(configurations.deletedAt)))
    .limit(1);
  if (config === undefined) return UNKNOWN;

  const [latest] = await db.select({
    id: configurationSheetSnapshots.id,
    version: configurationSheetSnapshots.version,
    approvedAt: configurationSheetSnapshots.approvedAt,
  })
    .from(configurationSheetSnapshots)
    .where(and(
      eq(configurationSheetSnapshots.configurationId, configId),
      isNotNull(configurationSheetSnapshots.approvedAt),
    ))
    .orderBy(desc(configurationSheetSnapshots.version))
    .limit(1);

  return decideSheetPaperCheck({
    claim,
    named,
    config,
    latestApproved: latest === undefined || latest.approvedAt === null
      ? null
      : { id: latest.id, version: latest.version, approvedAt: latest.approvedAt },
  });
}

/** The approved version a served sheet is, when it is one. */
export interface SheetIssue {
  readonly snapshotId: string;
  readonly version: number;
  readonly sourceHash: string;
}

/**
 * The paper check a served sheet carries: its check link and that link as a
 * QR matrix for renderers without an encoder (the web print). Returns null
 * if the QR cannot be encoded; the sheet then prints its sign-in link as before.
 */
export async function buildSheetPaperCheck(
  baseUrl: string,
  configId: string,
  issue: SheetIssue | null,
): Promise<SheetPaperCheck | null> {
  const url = buildSheetPaperCheckUrl(baseUrl, issue === null
    ? { kind: "working", configId }
    : { kind: "issued", issue: { snapshotId: issue.snapshotId, version: issue.version, fingerprint: paperFingerprint(issue.sourceHash) } });
  try {
    const QRCode = await import("qrcode");
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    const rows: string[] = [];
    for (let row = 0; row < modules.size; row++) {
      let line = "";
      for (let col = 0; col < modules.size; col++) line += modules.get(row, col) === 1 ? "1" : "0";
      rows.push(line);
    }
    return { url, qr: { size: modules.size, rows } };
  } catch {
    return null;
  }
}
