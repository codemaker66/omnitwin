import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  ENGAGEMENT_REPEAT_WINDOW_MINUTES,
  ENGAGEMENT_RETENTION_MONTHS,
  PROPOSAL_VIEW_VISIT_GAP_MINUTES,
  type AcquisitionContext,
  type EngagementEventKind,
  type FirstResponseChannel,
} from "@omnitwin/types";
import { enquiries, opportunities, proposalShareTokens, venueEngagementEvents } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { PUBLIC_DISCOVERY_VENUES } from "./public-discovery.js";

// ---------------------------------------------------------------------------
// The enquiry funnel's writers (migration 0100). Every new column and the
// engagement table are written here and nowhere else, so each rule below holds
// for every route that records a funnel fact.
//
//   - The first reply is a "minimum register": a write lands only when the
//     enquiry has no reply yet or a later one than this, in one UPDATE whose
//     WHERE PostgreSQL re-checks against the row it has locked. Concurrent
//     writers therefore agree on the earliest reply whatever order they commit
//     in, and who and how always travel with when.
//   - A proposal link's visits are counted in one UPDATE that reads the row's
//     previous values, so concurrent openings cannot lose a count or make two
//     "first" visits.
//   - Engagement rows belong to one enquiry or proposal of the venue's (the
//     database's composite keys refuse anything else) and carry nothing about
//     the person.
// ---------------------------------------------------------------------------

type Conn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface FirstResponseStamp {
  readonly at: Date;
  readonly byUserId: string | null;
  readonly channel: FirstResponseChannel;
  readonly recordedAt: Date;
}

export interface StampFirstResponseInput {
  readonly enquiryId: string;
  /** The venue the caller acted at: an enquiry of another venue is never stamped. */
  readonly venueId: string;
  /** When the reply was made: "now" for a reply Venviewer is sending itself,
   *  or a reported time, which is recorded as at most the server's now. */
  readonly at: Date | "now";
  readonly byUserId: string | null;
  readonly channel: FirstResponseChannel;
}

export interface StampFirstResponseResult {
  /** Whether this write became the enquiry's first reply. */
  readonly changed: boolean;
  /** The enquiry's first reply after the write; null when it has none (it is
   *  not this venue's, or the time given was before it arrived). */
  readonly stamp: FirstResponseStamp | null;
}

const stampColumns = {
  at: enquiries.firstResponseAt,
  byUserId: enquiries.firstResponseBy,
  channel: enquiries.firstResponseChannel,
  recordedAt: enquiries.firstResponseRecordedAt,
};

function toStamp(row: {
  readonly at: Date | null;
  readonly byUserId: string | null;
  readonly channel: FirstResponseChannel | null;
  readonly recordedAt: Date | null;
} | undefined): FirstResponseStamp | null {
  if (row === undefined || row.at === null || row.channel === null || row.recordedAt === null) return null;
  return { at: row.at, byUserId: row.byUserId, channel: row.channel, recordedAt: row.recordedAt };
}

/**
 * Record a reply as the enquiry's first when it is earlier than the one it
 * holds (or it holds none). Never before the enquiry arrived, never later than
 * the moment it is recorded, and only for an enquiry of `venueId`.
 */
export async function stampFirstResponse(conn: Conn, input: StampFirstResponseInput): Promise<StampFirstResponseResult> {
  const given = input.at === "now" ? sql`now()` : sql`LEAST(${input.at.toISOString()}::timestamptz, now())`;
  // A time is given to the millisecond and the arrival is kept to the
  // microsecond: a reply made the moment the enquiry arrived counts as made
  // then, recorded as the arrival itself rather than refused.
  const at = sql`GREATEST(${given}, ${enquiries.createdAt})`;
  const [written] = await conn.update(enquiries)
    .set({
      firstResponseAt: at,
      firstResponseBy: input.byUserId,
      firstResponseChannel: input.channel,
      firstResponseRecordedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(enquiries.id, input.enquiryId),
      eq(enquiries.venueId, input.venueId),
      sql`${given} >= date_trunc('milliseconds', ${enquiries.createdAt})`,
      or(isNull(enquiries.firstResponseAt), sql`${enquiries.firstResponseAt} > ${at}`),
    ))
    .returning(stampColumns);
  if (written !== undefined) return { changed: true, stamp: toStamp(written) };
  const [current] = await conn.select(stampColumns)
    .from(enquiries)
    .where(and(eq(enquiries.id, input.enquiryId), eq(enquiries.venueId, input.venueId)))
    .limit(1);
  return { changed: false, stamp: toStamp(current) };
}

/**
 * Lock an enquiry's row and read the first reply it holds, so a report can
 * record exactly which reply it replaced (the audit keeps every report, and
 * the enquiry only the earliest). Inside the reporting transaction.
 */
export async function lockFirstResponse(conn: Conn, enquiryId: string, venueId: string): Promise<FirstResponseStamp | null> {
  const [row] = await conn.select(stampColumns)
    .from(enquiries)
    .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, venueId)))
    .limit(1)
    .for("update");
  return toStamp(row);
}

/**
 * The enquiry a proposal answers: the one it carries, or else its deal's, and
 * only while that deal is the proposal's venue's. The stamp itself refuses an
 * enquiry of another venue, so a stale link can never reply across venues.
 */
export async function enquiryAnsweredByProposal(conn: Conn, proposal: {
  readonly venueId: string;
  readonly enquiryId: string | null;
  readonly opportunityId: string | null;
}): Promise<string | null> {
  if (proposal.enquiryId !== null) return proposal.enquiryId;
  if (proposal.opportunityId === null) return null;
  const [deal] = await conn.select({ enquiryId: opportunities.sourceEnquiryId })
    .from(opportunities)
    .where(and(eq(opportunities.id, proposal.opportunityId), eq(opportunities.venueId, proposal.venueId)))
    .limit(1);
  return deal?.enquiryId ?? null;
}

/**
 * Count one opening of a proposal link. An opening at least
 * PROPOSAL_VIEW_VISIT_GAP_MINUTES after the last is a new visit; the first
 * visit stamps first_viewed_at. A link whose visits were never counted (opened
 * before migration 0100, or by the release before it while 0100 was already
 * applied: a count of 0 beside a last view) stays unknown, both NULL, rather
 * than calling a later visit its first. Every SET expression reads the row's
 * previous values, so concurrent openings serialise on the row lock.
 */
export async function countProposalView(conn: Conn, shareTokenId: string): Promise<void> {
  const t = proposalShareTokens;
  const uncounted = sql`(${t.viewCount} IS NULL OR (${t.viewCount} = 0 AND ${t.lastViewedAt} IS NOT NULL))`;
  const newVisit = sql`(${t.lastViewedAt} IS NULL OR ${t.lastViewedAt} < now() - make_interval(mins => ${PROPOSAL_VIEW_VISIT_GAP_MINUTES}))`;
  await conn.update(t)
    .set({
      viewCount: sql`CASE WHEN ${uncounted} THEN NULL WHEN ${newVisit} THEN ${t.viewCount} + 1 ELSE ${t.viewCount} END`,
      firstViewedAt: sql`CASE WHEN ${uncounted} THEN NULL ELSE COALESCE(${t.firstViewedAt}, now()) END`,
      // now() is when each opening's transaction began, so an opening that
      // began earlier can commit later: the last view never moves back.
      lastViewedAt: sql`GREATEST(${t.lastViewedAt}, now())`,
    })
    .where(eq(t.id, shareTokenId));
}

/** Record what happened before an enquiry was sent, each kind once. */
export async function recordEnquiryEngagement(conn: Conn, input: {
  readonly venueId: string;
  readonly enquiryId: string;
  /** The room, when the enquiry names one. */
  readonly spaceId: string | null;
  readonly kinds: readonly EngagementEventKind[];
}): Promise<number> {
  const kinds = [...new Set(input.kinds)];
  if (kinds.length === 0) return 0;
  const rows = await conn.insert(venueEngagementEvents)
    .values(kinds.map((kind) => ({ venueId: input.venueId, enquiryId: input.enquiryId, spaceId: input.spaceId, kind })))
    .returning({ id: venueEngagementEvents.id });
  return rows.length;
}

/**
 * Record a moment on a proposal's page, once per ENGAGEMENT_REPEAT_WINDOW_MINUTES
 * for each proposal and kind: the same walk reported twice (a reload, a retry)
 * is one. A transaction-scoped advisory lock on the proposal and kind makes the
 * check and the insert one step, so two reports at once still make one row.
 */
export async function recordProposalEngagement(db: Database, input: {
  readonly venueId: string;
  readonly proposalId: string;
  readonly kind: EngagementEventKind;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`venue-engagement:${input.proposalId}:${input.kind}`}, 0))`);
    const [recent] = await tx.select({ id: venueEngagementEvents.id })
      .from(venueEngagementEvents)
      .where(and(
        eq(venueEngagementEvents.proposalId, input.proposalId),
        eq(venueEngagementEvents.kind, input.kind),
        sql`${venueEngagementEvents.recordedAt} > now() - make_interval(mins => ${ENGAGEMENT_REPEAT_WINDOW_MINUTES})`,
      ))
      .limit(1);
    if (recent !== undefined) return false;
    await tx.insert(venueEngagementEvents).values({ venueId: input.venueId, proposalId: input.proposalId, kind: input.kind });
    return true;
  });
}

/** The nightly retention pass: every engagement event older than
 *  ENGAGEMENT_RETENTION_MONTHS goes. Returns how many went. */
export async function removeExpiredEngagementEvents(db: Database): Promise<number> {
  const removed = await db.delete(venueEngagementEvents)
    .where(sql`${venueEngagementEvents.recordedAt} < now() - make_interval(months => ${ENGAGEMENT_RETENTION_MONTHS})`)
    .returning({ id: venueEngagementEvents.id });
  return removed.length;
}

/**
 * Whether the server reads what only a browser can send: an enquiry's
 * attribution and engagement, and a proposal page's engagement. Off unless
 * ENQUIRY_FUNNEL_BROWSER_SIGNALS is "on", which is set only once the privacy
 * page describes both and visitors can object (PECR Schedule A1 paragraph 5;
 * Blake, 19 October 2026). While off the server keeps none of it, whatever a
 * page sends, so the privacy page stays true without trusting any page.
 */
export function funnelBrowserSignalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["ENQUIRY_FUNNEL_BROWSER_SIGNALS"] === "on";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Venviewer's own production host, whatever the environment says. */
const VENVIEWER_HOST = "venviewer.com";

/**
 * Where Venviewer's pages and the venue's own website are, for reading an
 * enquiry's referrer: Venviewer's production host plus the frontend and CORS
 * origins this API serves, and the official website of the public venue
 * profile whose database slug is `venueSlug` (none for a venue without one).
 */
export function acquisitionContextFor(venueSlug: string | null, env: NodeJS.ProcessEnv = process.env): AcquisitionContext {
  const origins = [env["FRONTEND_URL"] ?? "", ...(env["CORS_ORIGINS"] ?? "").split(",")]
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  const siteHosts = [...new Set([VENVIEWER_HOST, ...origins.map(hostOf).filter((host): host is string => host !== null)])];
  const venueHosts = venueSlug === null ? [] : PUBLIC_DISCOVERY_VENUES
    .filter((profile) => profile.dbSlug === venueSlug)
    .map((profile) => hostOf(profile.officialWebsite))
    .filter((host): host is string => host !== null);
  return { siteHosts, venueHosts };
}
