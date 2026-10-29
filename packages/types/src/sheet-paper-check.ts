import { z } from "zod";

// ---------------------------------------------------------------------------
// Paper that knows its version — "One Living Record", first slice.
//
// Every printed hallkeeper sheet states in words which version it is and
// when it was printed ("v7, issued 16 Oct 14:02, printed 17 Oct 06:02"), and
// carries a QR code that leads to a page anyone holding the paper can open
// without signing in. That page answers one question — is this copy current?
// — and nothing else: no event, room, guest or contact detail ever crosses
// it, so a sheet found in a bin leaks nothing through its code.
//
// Two kinds of copy are printed today:
//   - an ISSUED copy: an approved sheet snapshot. Its link names the
//     snapshot, its version and a fingerprint of the snapshot's source hash,
//     so a guessed or altered link cannot be confirmed.
//   - a WORKING copy: a sheet printed before approval. Its link names only
//     the layout, so the page can say "Not the approved sheet: ask for v3"
//     once a version has been approved.
//
// Scope, stated honestly: versions belong to one room's layout (one
// configuration), not yet to the whole event. An event with two rooms has
// two sheets, each checked on its own.
// ---------------------------------------------------------------------------

/** Where the check page lives on the web app. The QR code opens this path. */
export const SHEET_PAPER_CHECK_PATH = "/sheet-check";

/** Hex characters of the snapshot's source hash carried by an issued copy. */
export const SHEET_PAPER_FINGERPRINT_LENGTH = 16;

const SnapshotVersionSchema = z.number().int().min(1).max(99_999);
const FingerprintSchema = z.string().regex(/^[0-9a-f]{16}$/u, "Fingerprint must be 16 lowercase hex characters.");
/** A version as it arrives in a query string: digits only, no exponent, no sign. */
const VersionParamSchema = z.string().regex(/^[1-9]\d{0,4}$/u).transform(Number);

/** The venue-local wall-clock minute a copy was printed, e.g. "2026-10-17T06:02". */
export const PaperWallClockSchema = z.string().regex(
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/u,
  "Printed time must be a venue wall-clock minute.",
);

/** The approved version a printed copy was made from. */
export const SheetPaperIssueSchema = z.object({
  snapshotId: z.uuid(),
  version: SnapshotVersionSchema,
  fingerprint: FingerprintSchema,
});
export type SheetPaperIssue = z.infer<typeof SheetPaperIssueSchema>;

const IssuedQuerySchema = z.object({ s: z.uuid(), v: VersionParamSchema, h: FingerprintSchema });
const WorkingQuerySchema = z.object({ c: z.uuid() });

/**
 * What the public check endpoint accepts. An issued copy is tried first, so a
 * link carrying both shapes is checked as the stricter, issued one. Unknown
 * keys (the printed time `p`) are stripped: the server never needs them.
 */
export const SheetPaperCheckQuerySchema = z.union([IssuedQuerySchema, WorkingQuerySchema]);
export type SheetPaperCheckQuery = z.infer<typeof SheetPaperCheckQuerySchema>;
export type IssuedSheetPaperQuery = z.infer<typeof IssuedQuerySchema>;

/** True when the query names an issued (approved) copy. */
export function isIssuedPaperQuery(query: SheetPaperCheckQuery): query is IssuedSheetPaperQuery {
  return "s" in query;
}

/**
 * The whole answer. Deliberately version state only:
 *   current      the copy is the version in force
 *   superseded   a newer version is in force; ask for it by number
 *   not_approved no version is in force: the layout is being prepared or revised
 *   retired      the layout is closed for good (archived after the event)
 *   unknown      the link cannot be confirmed (altered, unknown or damaged)
 * "unknown" is one answer for every failure, so the endpoint cannot be used
 * to learn which part of a guessed link was wrong.
 */
export const SheetPaperCheckResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("current"), version: SnapshotVersionSchema }),
  z.object({ state: z.literal("superseded"), currentVersion: SnapshotVersionSchema }),
  z.object({ state: z.literal("not_approved") }),
  z.object({ state: z.literal("retired") }),
  z.object({ state: z.literal("unknown") }),
]);
export type SheetPaperCheckResult = z.infer<typeof SheetPaperCheckResultSchema>;

/** A QR code as rows of dark (1) and light (0) modules, without its quiet zone. */
export const SheetPaperQrSchema = z.object({
  size: z.number().int().min(21).max(177),
  rows: z.array(z.string().regex(/^[01]+$/u)),
}).refine(
  (qr) => qr.rows.length === qr.size && qr.rows.every((row) => row.length === qr.size),
  "QR rows must form a size × size square.",
);
export type SheetPaperQr = z.infer<typeof SheetPaperQrSchema>;

/**
 * What a served sheet carries so its printouts can be checked. Overlaid when
 * the sheet is served and never stored in a frozen snapshot: `url` is the
 * check link without a printed time; renderers add their own with
 * `withPrintedAt`. `qr` encodes `url` for renderers with no QR encoder.
 */
export const SheetPaperCheckSchema = z.object({
  url: z.url(),
  qr: SheetPaperQrSchema,
});
export type SheetPaperCheck = z.infer<typeof SheetPaperCheckSchema>;

export type SheetPaperTarget =
  | { readonly kind: "issued"; readonly issue: SheetPaperIssue }
  | { readonly kind: "working"; readonly configId: string };

/** The check link for a copy, without its printed time. */
export function buildSheetPaperCheckUrl(baseUrl: string, target: SheetPaperTarget): string {
  const base = baseUrl.replace(/\/+$/u, "");
  const params = target.kind === "issued"
    ? `s=${target.issue.snapshotId}&v=${String(target.issue.version)}&h=${target.issue.fingerprint}`
    : `c=${target.configId}`;
  return `${base}${SHEET_PAPER_CHECK_PATH}?${params}`;
}

/** The link printed on one copy: the check link plus that copy's printed minute. */
export function withPrintedAt(checkUrl: string, printedWallClock: string): string {
  if (!PaperWallClockSchema.safeParse(printedWallClock).success) return checkUrl;
  return `${checkUrl}${checkUrl.includes("?") ? "&" : "?"}p=${printedWallClock}`;
}

/** The fingerprint an issued copy carries for a 64-hex source hash. */
export function paperFingerprint(sourceHash: string): string {
  return sourceHash.slice(0, SHEET_PAPER_FINGERPRINT_LENGTH).toLowerCase();
}

/**
 * The venue's wall-clock minute for an instant, "2026-10-17T06:02". Printed
 * times are venue-local so a copy reads the same wherever it was rendered.
 * Returns null for an unreadable instant or zone.
 */
export function venueWallClock(instant: Date | string, timeZone: string): string | null {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const wall = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  return PaperWallClockSchema.safeParse(wall).success ? wall : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-17T06:02" → "17 Oct 06:02". Read as written: no zone conversion. */
export function formatPaperWallClock(wall: string): string | null {
  if (!PaperWallClockSchema.safeParse(wall).success) return null;
  const month = MONTHS[Number(wall.slice(5, 7)) - 1];
  if (month === undefined) return null;
  return `${String(Number(wall.slice(8, 10)))} ${month} ${wall.slice(11, 16)}`;
}

/**
 * The version line every printed copy carries, in words:
 *   "v7, issued 16 Oct 14:02, printed 17 Oct 06:02"
 *   "Draft, printed 17 Oct 06:02"   (printed before approval)
 * Dates are included because a sheet is usually issued days before the
 * morning it is printed; "issued 14:02" alone would not say which day.
 */
export function describeSheetCopy(input: {
  readonly version: number | null;
  readonly issuedAt: string | null;
  readonly printedAt: string | null;
  readonly timeZone: string;
}): string {
  const printedWall = input.printedAt === null ? null : venueWallClock(input.printedAt, input.timeZone);
  const printed = printedWall === null ? null : formatPaperWallClock(printedWall);
  const parts: string[] = [];
  if (input.version === null) {
    parts.push("Draft");
  } else {
    parts.push(`v${String(input.version)}`);
    const issuedWall = input.issuedAt === null ? null : venueWallClock(input.issuedAt, input.timeZone);
    const issued = issuedWall === null ? null : formatPaperWallClock(issuedWall);
    if (issued !== null) parts.push(`issued ${issued}`);
  }
  if (printed !== null) parts.push(`printed ${printed}`);
  return parts.join(", ");
}

/** What the paper itself claims, read from its link: shown back, never trusted. */
export interface PaperCopyClaim {
  readonly kind: "issued" | "working";
  readonly version: number | null;
  readonly printed: string | null;
}

/**
 * Read a scanned link. Returns null when it is not a sheet check at all.
 * `claim` is what the paper says about itself (its version and printed
 * minute), used for the offline answer; `query` is what the server checks.
 */
export function parseSheetPaperLink(params: URLSearchParams): {
  readonly query: SheetPaperCheckQuery;
  readonly claim: PaperCopyClaim;
} | null {
  const raw: Record<string, string> = {};
  for (const key of ["s", "v", "h", "c"]) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = SheetPaperCheckQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const printedRaw = params.get("p");
  const printed = printedRaw !== null && PaperWallClockSchema.safeParse(printedRaw).success ? printedRaw : null;
  const query = parsed.data;
  return isIssuedPaperQuery(query)
    ? { query, claim: { kind: "issued", version: query.v, printed } }
    : { query, claim: { kind: "working", version: null, printed } };
}

/** "Your copy is v7, printed 17 Oct 06:02." — the paper's own claim, in words. */
export function describePaperClaim(claim: PaperCopyClaim): string {
  const printed = claim.printed === null ? null : formatPaperWallClock(claim.printed);
  if (claim.version === null) {
    return printed === null ? "Your copy is a draft." : `Your copy is a draft, printed ${printed}.`;
  }
  return printed === null
    ? `Your copy is v${String(claim.version)}.`
    : `Your copy is v${String(claim.version)}, printed ${printed}.`;
}
