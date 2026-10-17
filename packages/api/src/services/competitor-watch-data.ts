import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  COMPETITOR_SET_LIMIT,
  MARKET_CONTEXT_LIMIT,
  SUGGESTED_COMPETITOR_SET,
  captureFreshness,
  captureSourceRefusal,
  isReviewDue,
  pricePageRefusal,
  reviewDueFrom,
  websiteRefusal,
  type CaptureCreate,
  type Competitor,
  type CompetitorCapture,
  type CompetitorCreate,
  type CompetitorNames,
  type CompetitorUpdate,
  type CompetitorWatch,
  type MarketContext,
  type MarketContextLine,
  type OpportunityLostTo,
  type PageCheckResult,
  type PageCheckRun,
} from "@omnitwin/types";
import {
  competitorLosses,
  competitorPageChecks,
  competitorPriceCaptures,
  competitorVenues,
  files,
  opportunities,
  opportunityStatusHistory,
  users,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { TRADES_HALL_VENUE_SLUG } from "../lib/venue-site.js";
import { userDisplayName } from "../utils/user-display-name.js";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "./booking-mutations.js";
import { checkPage, nextCheckAfter, type PageFetcher } from "./page-check.js";

// ---------------------------------------------------------------------------
// The competitor watch's reads and writes (routes/competitor-watch.ts).
//
// Every query names the venue, and every child row is bound to its venue by
// a composite key in migration 0095, so one venue's watch is never read or
// written through another's. Nothing here is read by the suggestion maths:
// pricing-advice.ts and pricing-desk-data.ts never import this file, and a
// test holds them to it.
// ---------------------------------------------------------------------------

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export interface WatchRefusal {
  readonly ok: false;
  readonly status: 404 | 409 | 422;
  readonly code: string;
  readonly error: string;
}

export type WatchWrite<T> = ({ readonly ok: true } & T) | WatchRefusal;

function refusal(status: 404 | 409 | 422, code: string, error: string): WatchRefusal {
  return { ok: false, status, code, error };
}

const NOT_IN_SET = refusal(404, "NOT_FOUND", "That venue is not in this venue's competitor set.");

/** The files context a capture's screenshot or brochure is stored under;
 *  its context id is the competitor's. */
export const COMPETITOR_EVIDENCE_CONTEXT = "competitor_watch";

/** The venue's own date for `now` ("YYYY-MM-DD"). */
export function venueToday(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

interface WatchVenue {
  readonly id: string;
  readonly slug: string;
  readonly timezone: string;
}

async function liveVenue(db: Executor, venueId: string): Promise<WatchVenue | null> {
  const [venue] = await db.select({ id: venues.id, slug: venues.slug, timezone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  return venue ?? null;
}

/** Serialises writes to one venue's set (its size limit, the suggested set). */
async function lockSet(tx: Transaction, venueId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`competitor_set:${venueId}`}, 0))`);
}

type CompetitorRow = typeof competitorVenues.$inferSelect;
type CaptureRow = typeof competitorPriceCaptures.$inferSelect;

/** The page change still standing: found, and not dismissed since. */
function standingChange(row: Pick<CompetitorRow, "pageChangedAt" | "pageChangeDismissedAt">): Date | null {
  if (row.pageChangedAt === null) return null;
  if (row.pageChangeDismissedAt !== null && row.pageChangeDismissedAt >= row.pageChangedAt) return null;
  return row.pageChangedAt;
}

async function namesOf(db: Executor, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: userDisplayName }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.flatMap((row) => (row.name === null ? [] : [[row.id, row.name] as const])));
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function sortSet<T extends { readonly tier: string; readonly name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name, "en-GB") : a.tier === "primary" ? -1 : 1));
}

function captureOut(row: CaptureRow, supersededBy: ReadonlyMap<string, string>, names: ReadonlyMap<string, string>, today: string, changedOn: string | null): CompetitorCapture {
  return {
    id: row.id,
    competitorId: row.competitorId,
    sourceUrl: row.sourceUrl,
    sourceKind: row.sourceKind,
    seenOn: row.seenOn,
    capturedAt: row.capturedAt.toISOString(),
    capturedByName: names.get(row.capturedBy) ?? null,
    packageName: row.packageName,
    amountMinor: row.amountMinor,
    currency: row.currency,
    priceBasis: row.priceBasis,
    guests: row.guests,
    priceYear: row.priceYear,
    includes: row.includes,
    includesNote: row.includesNote,
    vat: row.vat,
    evidenceFileId: row.evidenceFileId,
    note: row.note,
    supersedesId: row.supersedesId,
    supersededById: supersededBy.get(row.id) ?? null,
    sourceGoneAt: iso(row.sourceGoneAt),
    sourceGoneByName: row.sourceGoneBy === null ? null : names.get(row.sourceGoneBy) ?? null,
    freshness: captureFreshness({ seenOn: row.seenOn, priceYear: row.priceYear, sourceGoneAt: iso(row.sourceGoneAt) }, today, changedOn),
  };
}

const LOSS_WINDOW_MS = 365 * 86_400_000;
const LOSSES_LISTED = 3;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The venue's watch, or null when the venue is not there. */
export async function loadCompetitorWatch(db: Database, venueId: string, now: Date): Promise<CompetitorWatch | null> {
  const venue = await liveVenue(db, venueId);
  if (venue === null) return null;
  const today = venueToday(now, venue.timezone);

  const set = sortSet(await db.select().from(competitorVenues)
    .where(and(eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt))));
  const ids = set.map((row) => row.id);

  const [captures, losses] = ids.length === 0 ? [[], []] : await Promise.all([
    db.select().from(competitorPriceCaptures)
      .where(and(eq(competitorPriceCaptures.venueId, venueId), inArray(competitorPriceCaptures.competitorId, ids)))
      .orderBy(desc(competitorPriceCaptures.capturedAt), desc(competitorPriceCaptures.id)),
    db.select({
      competitorId: competitorLosses.competitorId,
      at: competitorLosses.recordedAt,
      dealTitle: opportunities.title,
      reason: opportunityStatusHistory.note,
    })
      .from(competitorLosses)
      .innerJoin(opportunities, and(eq(opportunities.id, competitorLosses.opportunityId), eq(opportunities.venueId, venueId)))
      .innerJoin(opportunityStatusHistory, eq(opportunityStatusHistory.id, competitorLosses.statusHistoryId))
      .where(and(
        eq(competitorLosses.venueId, venueId),
        inArray(competitorLosses.competitorId, ids),
        gte(competitorLosses.recordedAt, new Date(now.getTime() - LOSS_WINDOW_MS)),
        isNull(opportunities.deletedAt),
      ))
      .orderBy(desc(competitorLosses.recordedAt), desc(competitorLosses.id)),
  ]);

  const names = await namesOf(db, [
    ...set.flatMap((row) => [row.createdBy, row.reviewedBy, row.checksAllowedBy]),
    ...captures.flatMap((row) => [row.capturedBy, row.sourceGoneBy]),
  ]);
  const supersededBy = new Map(captures.flatMap((row) => (row.supersedesId === null ? [] : [[row.supersedesId, row.id] as const])));

  const competitors: Competitor[] = set.map((row) => {
    const own = captures.filter((capture) => capture.competitorId === row.id);
    const change = standingChange(row);
    const changedOn = change === null ? null : venueToday(change, venue.timezone);
    const unanswered = change !== null && !own.some((capture) => capture.capturedAt > change);
    const lost = losses.filter((loss) => loss.competitorId === row.id);
    return {
      id: row.id,
      name: row.name,
      website: row.website,
      pricePageUrl: row.pricePageUrl,
      tier: row.tier,
      reason: row.reason,
      reviewDueOn: row.reviewDueOn,
      reviewDue: isReviewDue(row.reviewDueOn, today),
      reviewedAt: iso(row.reviewedAt),
      reviewedByName: row.reviewedBy === null ? null : names.get(row.reviewedBy) ?? null,
      addedAt: row.createdAt.toISOString(),
      addedByName: row.createdBy === null ? null : names.get(row.createdBy) ?? null,
      pageCheck: {
        allowedAt: iso(row.checksAllowedAt),
        allowedByName: row.checksAllowedBy === null ? null : names.get(row.checksAllowedBy) ?? null,
        checkedAt: iso(row.pageCheckedAt),
        outcome: row.pageCheckOutcome,
        httpStatus: row.pageCheckStatus,
        nextCheckAfter: iso(row.nextCheckAfter),
        changedAt: unanswered ? iso(change) : null,
      },
      captures: own.map((capture) => captureOut(capture, supersededBy, names, today, changedOn)),
      losses: {
        count: lost.length,
        recent: lost.slice(0, LOSSES_LISTED).map((loss) => ({ at: loss.at.toISOString(), dealTitle: loss.dealTitle, reason: loss.reason })),
      },
    };
  });

  return {
    today,
    timezone: venue.timezone,
    limit: COMPETITOR_SET_LIMIT,
    suggestedSetOffered: venue.slug === TRADES_HALL_VENUE_SLUG && set.length === 0,
    competitors,
  };
}

/**
 * The Current figures for one year, beside a suggestion: in the set's order
 * (primary first, then by name, then by package), never by price, at most
 * six. Replaced figures, gone sources and figures due a check are left out;
 * how many were due a check is said.
 */
export async function loadMarketContext(db: Database, venueId: string, year: number, now: Date): Promise<MarketContext | null> {
  const venue = await liveVenue(db, venueId);
  if (venue === null) return null;
  const today = venueToday(now, venue.timezone);
  const set = await db.select().from(competitorVenues)
    .where(and(eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)));
  if (set.length === 0) return { year, today, lines: [], more: 0, checkDue: 0 };
  const byId = new Map(set.map((row) => [row.id, row]));

  const [rows, replacements] = await Promise.all([
    db.select().from(competitorPriceCaptures)
      .where(and(
        eq(competitorPriceCaptures.venueId, venueId),
        inArray(competitorPriceCaptures.competitorId, set.map((row) => row.id)),
        eq(competitorPriceCaptures.priceYear, year),
        isNull(competitorPriceCaptures.sourceGoneAt),
      )),
    db.select({ id: competitorPriceCaptures.supersedesId }).from(competitorPriceCaptures)
      .where(and(eq(competitorPriceCaptures.venueId, venueId), isNotNull(competitorPriceCaptures.supersedesId))),
  ]);
  const replaced = new Set(replacements.flatMap((row) => (row.id === null ? [] : [row.id])));

  const names = await namesOf(db, rows.map((row) => row.capturedBy));
  let checkDue = 0;
  const current: { readonly order: string; readonly line: MarketContextLine }[] = [];
  for (const row of rows) {
    const competitor = byId.get(row.competitorId);
    if (competitor === undefined || replaced.has(row.id) || row.priceYear === null) continue;
    const change = standingChange(competitor);
    const freshness = captureFreshness(
      { seenOn: row.seenOn, priceYear: row.priceYear, sourceGoneAt: null },
      today,
      change === null ? null : venueToday(change, venue.timezone),
    );
    if (freshness === "check_due") checkDue += 1;
    if (freshness !== "current") continue;
    current.push({
      order: `${competitor.tier === "primary" ? "0" : "1"}|${competitor.name.toLowerCase()}|${row.packageName.toLowerCase()}|${row.id}`,
      line: {
        captureId: row.id,
        competitorId: competitor.id,
        competitorName: competitor.name,
        tier: competitor.tier,
        packageName: row.packageName,
        amountMinor: row.amountMinor,
        currency: row.currency,
        priceBasis: row.priceBasis,
        guests: row.guests,
        priceYear: row.priceYear,
        includes: row.includes,
        includesNote: row.includesNote,
        vat: row.vat,
        seenOn: row.seenOn,
        capturedByName: names.get(row.capturedBy) ?? null,
        sourceUrl: row.sourceUrl,
        sourceKind: row.sourceKind,
      },
    });
  }
  current.sort((a, b) => a.order.localeCompare(b.order, "en-GB"));
  return {
    year,
    today,
    lines: current.slice(0, MARKET_CONTEXT_LIMIT).map((entry) => entry.line),
    more: Math.max(0, current.length - MARKET_CONTEXT_LIMIT),
    checkDue,
  };
}

/** The set by name, for "who won" when a deal is marked lost. */
export async function loadCompetitorNames(db: Database, venueId: string): Promise<CompetitorNames> {
  const rows = await db.select({ id: competitorVenues.id, name: competitorVenues.name, tier: competitorVenues.tier })
    .from(competitorVenues)
    .where(and(eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)));
  return sortSet(rows).map((row) => ({ id: row.id, name: row.name }));
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

function addressRefusal(website: string | null, pricePageUrl: string | null): string | null {
  if (website !== null) {
    const refused = websiteRefusal(website);
    if (refused !== null) return refused;
  }
  if (pricePageUrl !== null) return pricePageRefusal(pricePageUrl, website);
  return null;
}

function blankToNull(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value.trim();
}

const SET_FULL = refusal(409, "SET_FULL", `The set holds ${String(COMPETITOR_SET_LIMIT)} venues, its limit. Remove one before adding another.`);

async function liveCount(tx: Transaction, venueId: string): Promise<number> {
  const [counted] = await tx.select({ live: sql<number>`count(*)::int` }).from(competitorVenues)
    .where(and(eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)));
  return counted?.live ?? 0;
}

export async function createCompetitor(db: Database, venueId: string, actorId: string, input: CompetitorCreate, now: Date): Promise<WatchWrite<{ readonly id: string }>> {
  const website = blankToNull(input.website);
  const pricePageUrl = blankToNull(input.pricePageUrl);
  const refused = addressRefusal(website, pricePageUrl);
  if (refused !== null) return refusal(422, "ADDRESS_REFUSED", refused);
  const venue = await liveVenue(db, venueId);
  if (venue === null) return refusal(404, "NOT_FOUND", "Venue not found");
  try {
    return await db.transaction(async (tx): Promise<WatchWrite<{ readonly id: string }>> => {
      await lockSet(tx, venueId);
      if (await liveCount(tx, venueId) >= COMPETITOR_SET_LIMIT) return SET_FULL;
      const [row] = await tx.insert(competitorVenues).values({
        venueId, name: input.name, website, pricePageUrl, tier: input.tier, reason: input.reason,
        reviewDueOn: reviewDueFrom(venueToday(now, venue.timezone)), createdBy: actorId, updatedBy: actorId,
        createdAt: now, updatedAt: now,
      }).returning({ id: competitorVenues.id });
      if (row === undefined) throw new Error("competitor insert returned nothing");
      return { ok: true, id: row.id };
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return refusal(409, "NAME_TAKEN", `${input.name} is already in the set.`);
    throw error;
  }
}

/** Loads the approved set, with each reason, into an empty set. Offered to
 *  Trades Hall only: the set is Glasgow's. */
export async function loadSuggestedSet(db: Database, venueId: string, actorId: string, now: Date): Promise<WatchWrite<{ readonly added: number }>> {
  const venue = await liveVenue(db, venueId);
  if (venue === null) return refusal(404, "NOT_FOUND", "Venue not found");
  if (venue.slug !== TRADES_HALL_VENUE_SLUG) {
    return refusal(409, "NO_SUGGESTED_SET", "There is no suggested set for this venue. Add the venues you compare yourselves with, one at a time.");
  }
  const reviewDueOn = reviewDueFrom(venueToday(now, venue.timezone));
  return db.transaction(async (tx): Promise<WatchWrite<{ readonly added: number }>> => {
    await lockSet(tx, venueId);
    if (await liveCount(tx, venueId) > 0) {
      return refusal(409, "SET_STARTED", "The set has already been started. Add or change venues one at a time.");
    }
    await tx.insert(competitorVenues).values(SUGGESTED_COMPETITOR_SET.map((entry) => ({
      venueId,
      name: entry.name,
      website: entry.website,
      pricePageUrl: entry.pricePageUrl,
      tier: entry.tier,
      reason: entry.reason,
      reviewDueOn,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    })));
    return { ok: true, added: SUGGESTED_COMPETITOR_SET.length };
  });
}

async function liveCompetitor(db: Executor, venueId: string, competitorId: string): Promise<CompetitorRow | null> {
  const [row] = await db.select().from(competitorVenues)
    .where(and(eq(competitorVenues.id, competitorId), eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)))
    .limit(1);
  return row ?? null;
}

export async function updateCompetitor(db: Database, venueId: string, competitorId: string, actorId: string, input: CompetitorUpdate, now: Date): Promise<WatchWrite<{ readonly checkReset: boolean }>> {
  const current = await liveCompetitor(db, venueId, competitorId);
  if (current === null) return NOT_IN_SET;
  const website = input.website === undefined ? current.website : blankToNull(input.website);
  const pricePageUrl = input.pricePageUrl === undefined ? current.pricePageUrl : blankToNull(input.pricePageUrl);
  const refused = addressRefusal(website, pricePageUrl);
  if (refused !== null) return refusal(422, "ADDRESS_REFUSED", refused);
  // A new address is a new site to read: the permission was for the old one.
  const checkReset = website !== current.website || pricePageUrl !== current.pricePageUrl;
  try {
    const [row] = await db.update(competitorVenues).set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.tier === undefined ? {} : { tier: input.tier }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      website,
      pricePageUrl,
      ...(checkReset ? {
        checksAllowedAt: null, checksAllowedBy: null, pageHash: null, pageCheckedAt: null, pageCheckOutcome: null,
        pageCheckStatus: null, pageChangedAt: null, pageChangeDismissedAt: null, pageChangeDismissedBy: null, nextCheckAfter: null,
      } : {}),
      updatedBy: actorId,
      updatedAt: now,
    })
      .where(and(eq(competitorVenues.id, competitorId), eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)))
      .returning({ id: competitorVenues.id });
    if (row === undefined) return NOT_IN_SET;
    return { ok: true, checkReset };
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return refusal(409, "NAME_TAKEN", `${input.name ?? current.name} is already in the set.`);
    throw error;
  }
}

/** One of the set's small writes, on a live competitor of this venue. */
async function touchCompetitor(db: Database, venueId: string, competitorId: string, values: Partial<typeof competitorVenues.$inferInsert>): Promise<boolean> {
  const [row] = await db.update(competitorVenues).set(values)
    .where(and(eq(competitorVenues.id, competitorId), eq(competitorVenues.venueId, venueId), isNull(competitorVenues.removedAt)))
    .returning({ id: competitorVenues.id });
  return row !== undefined;
}

export async function markReviewed(db: Database, venueId: string, competitorId: string, actorId: string, now: Date): Promise<WatchWrite<{ readonly reviewDueOn: string }>> {
  const venue = await liveVenue(db, venueId);
  if (venue === null) return NOT_IN_SET;
  const reviewDueOn = reviewDueFrom(venueToday(now, venue.timezone));
  const done = await touchCompetitor(db, venueId, competitorId, { reviewedAt: now, reviewedBy: actorId, reviewDueOn, updatedAt: now, updatedBy: actorId });
  return done ? { ok: true, reviewDueOn } : NOT_IN_SET;
}

export async function removeCompetitor(db: Database, venueId: string, competitorId: string, actorId: string, now: Date): Promise<WatchWrite<object>> {
  const done = await touchCompetitor(db, venueId, competitorId, { removedAt: now, removedBy: actorId, updatedAt: now, updatedBy: actorId });
  return done ? { ok: true } : NOT_IN_SET;
}

export async function allowPageCheck(db: Database, venueId: string, competitorId: string, actorId: string, now: Date): Promise<WatchWrite<object>> {
  const current = await liveCompetitor(db, venueId, competitorId);
  if (current === null) return NOT_IN_SET;
  if (current.pricePageUrl === null) return refusal(409, "NO_PAGE", "Record the page to check first, on the venue's own website.");
  const refused = pricePageRefusal(current.pricePageUrl, current.website);
  if (refused !== null) return refusal(409, "ADDRESS_REFUSED", refused);
  const done = await touchCompetitor(db, venueId, competitorId, {
    checksAllowedAt: now, checksAllowedBy: actorId, nextCheckAfter: null, updatedAt: now, updatedBy: actorId,
  });
  return done ? { ok: true } : NOT_IN_SET;
}

export async function withdrawPageCheck(db: Database, venueId: string, competitorId: string, actorId: string, now: Date): Promise<WatchWrite<object>> {
  const done = await touchCompetitor(db, venueId, competitorId, {
    checksAllowedAt: null, checksAllowedBy: null, nextCheckAfter: null, updatedAt: now, updatedBy: actorId,
  });
  return done ? { ok: true } : NOT_IN_SET;
}

export async function dismissPageChange(db: Database, venueId: string, competitorId: string, actorId: string, now: Date): Promise<WatchWrite<object>> {
  const done = await touchCompetitor(db, venueId, competitorId, { pageChangeDismissedAt: now, pageChangeDismissedBy: actorId });
  return done ? { ok: true } : NOT_IN_SET;
}

// ---------------------------------------------------------------------------
// Captures: append-only
// ---------------------------------------------------------------------------

export async function createCapture(db: Database, venueId: string, competitorId: string, actorId: string, input: CaptureCreate, now: Date): Promise<WatchWrite<{ readonly id: string }>> {
  const venue = await liveVenue(db, venueId);
  const competitor = await liveCompetitor(db, venueId, competitorId);
  if (venue === null || competitor === null) return NOT_IN_SET;
  const refused = captureSourceRefusal(input.sourceUrl, input.sourceKind, competitor.website);
  if (refused !== null) return refusal(422, "SOURCE_REFUSED", refused);
  if (input.seenOn > venueToday(now, venue.timezone)) return refusal(422, "SEEN_LATER", "The date seen cannot be after today.");

  if (input.supersedesId !== null) {
    const [older] = await db.select({ id: competitorPriceCaptures.id }).from(competitorPriceCaptures)
      .where(and(
        eq(competitorPriceCaptures.id, input.supersedesId),
        eq(competitorPriceCaptures.venueId, venueId),
        eq(competitorPriceCaptures.competitorId, competitorId),
      ))
      .limit(1);
    if (older === undefined) return refusal(422, "NOT_THEIR_CAPTURE", "The figure it replaces is not one of this venue's.");
  }
  if (input.evidenceFileId !== null) {
    const [file] = await db.select({ id: files.id }).from(files)
      .where(and(eq(files.id, input.evidenceFileId), eq(files.context, COMPETITOR_EVIDENCE_CONTEXT), eq(files.contextId, competitorId)))
      .limit(1);
    if (file === undefined) return refusal(422, "EVIDENCE_NOT_FOUND", "The screenshot was not stored for this venue. Add it again, or save the figure without it.");
  }

  try {
    const [row] = await db.insert(competitorPriceCaptures).values({
      venueId,
      competitorId,
      sourceUrl: input.sourceUrl,
      sourceKind: input.sourceKind,
      seenOn: input.seenOn,
      capturedBy: actorId,
      capturedAt: now,
      packageName: input.packageName,
      amountMinor: input.amountMinor,
      currency: input.currency,
      priceBasis: input.priceBasis,
      guests: input.guests,
      priceYear: input.priceYear,
      includes: [...input.includes],
      includesNote: input.includesNote === null || input.includesNote === "" ? null : input.includesNote,
      vat: input.vat,
      evidenceFileId: input.evidenceFileId,
      note: input.note === null || input.note === "" ? null : input.note,
      supersedesId: input.supersedesId,
    }).returning({ id: competitorPriceCaptures.id });
    if (row === undefined) throw new Error("capture insert returned nothing");
    return { ok: true, id: row.id };
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return refusal(409, "ALREADY_REPLACED", "That figure has already been replaced by a newer one. Open the newer figure to record another.");
    }
    throw error;
  }
}

export async function markSourceGone(db: Database, venueId: string, competitorId: string, captureId: string, actorId: string, now: Date): Promise<WatchWrite<object>> {
  const competitor = await liveCompetitor(db, venueId, competitorId);
  if (competitor === null) return NOT_IN_SET;
  const [row] = await db.update(competitorPriceCaptures).set({ sourceGoneAt: now, sourceGoneBy: actorId })
    .where(and(
      eq(competitorPriceCaptures.id, captureId),
      eq(competitorPriceCaptures.venueId, venueId),
      eq(competitorPriceCaptures.competitorId, competitorId),
      isNull(competitorPriceCaptures.sourceGoneAt),
    ))
    .returning({ id: competitorPriceCaptures.id });
  if (row !== undefined) return { ok: true };
  const [exists] = await db.select({ id: competitorPriceCaptures.id }).from(competitorPriceCaptures)
    .where(and(eq(competitorPriceCaptures.id, captureId), eq(competitorPriceCaptures.venueId, venueId), eq(competitorPriceCaptures.competitorId, competitorId)))
    .limit(1);
  return exists === undefined
    ? refusal(404, "NOT_FOUND", "That figure is not one of this venue's.")
    : refusal(409, "ALREADY_MARKED", "Its source is already marked gone.");
}

/** The venue a live competitor belongs to, for scoping a screenshot upload. */
export async function competitorVenueOf(db: Database, competitorId: string): Promise<string | null> {
  const [row] = await db.select({ venueId: competitorVenues.venueId }).from(competitorVenues)
    .where(and(eq(competitorVenues.id, competitorId), isNull(competitorVenues.removedAt)))
    .limit(1);
  return row?.venueId ?? null;
}

// ---------------------------------------------------------------------------
// Who won a lost deal
// ---------------------------------------------------------------------------

/** Checks a lost deal's winner against the deal's venue before anything is
 *  written: a competitor must be a live one of that venue's set. */
export async function lostToRefusal(db: Executor, venueId: string, lostTo: OpportunityLostTo): Promise<string | null> {
  if (lostTo.competitorId === null) return null;
  const competitor = await liveCompetitor(db, venueId, lostTo.competitorId);
  return competitor === null ? "That venue is not in this venue's competitor set. Choose another, or name it." : null;
}

export async function recordLoss(tx: Transaction, input: {
  readonly venueId: string;
  readonly opportunityId: string;
  readonly statusHistoryId: string;
  readonly lostTo: OpportunityLostTo;
  readonly actorId: string;
  readonly currency: string;
}): Promise<void> {
  await tx.insert(competitorLosses).values({
    venueId: input.venueId,
    opportunityId: input.opportunityId,
    statusHistoryId: input.statusHistoryId,
    competitorId: input.lostTo.competitorId,
    otherName: input.lostTo.otherName,
    clientFigureMinor: input.lostTo.clientFigureMinor,
    clientFigureBasis: input.lostTo.clientFigureBasis,
    currency: /^[A-Z]{3}$/u.test(input.currency) ? input.currency : "GBP",
    recordedBy: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// The page-change check
// ---------------------------------------------------------------------------

/** A claim holds a page for the run that took it, so two runs (the office's
 *  button and the schedule) never read one page twice. */
const CLAIM_MS = 15 * 60_000;
const CHECKS_AT_ONCE = 4;

async function inTurn<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Runs the page check for one venue's set (`venueId`) or, for the
 * unattended pass, every venue's allowed and due pages (`venueId` null).
 * Each page is claimed before it is read, read at most weekly, and its
 * result written with the check's log row in one transaction. A venue's
 * own run reports every competitor, with why one was not checked.
 */
export async function runPageChecks(db: Database, options: {
  readonly venueId: string | null;
  readonly now: Date;
  readonly fetcher: PageFetcher;
  readonly runBy: "person" | "schedule";
  readonly triggeredBy: string | null;
}): Promise<PageCheckRun> {
  const { now } = options;
  const scope = options.venueId === null
    ? and(
      isNull(competitorVenues.removedAt),
      isNotNull(competitorVenues.checksAllowedAt),
      isNotNull(competitorVenues.pricePageUrl),
      or(isNull(competitorVenues.nextCheckAfter), lte(competitorVenues.nextCheckAfter, now)),
    )
    : and(eq(competitorVenues.venueId, options.venueId), isNull(competitorVenues.removedAt));
  const candidates = await db.select({
    id: competitorVenues.id,
    venueId: competitorVenues.venueId,
    checksAllowedAt: competitorVenues.checksAllowedAt,
    pricePageUrl: competitorVenues.pricePageUrl,
    website: competitorVenues.website,
    nextCheckAfter: competitorVenues.nextCheckAfter,
  })
    .from(competitorVenues)
    .innerJoin(venues, and(eq(venues.id, competitorVenues.venueId), isNull(venues.deletedAt)))
    .where(scope)
    .orderBy(asc(competitorVenues.venueId), asc(competitorVenues.id));

  const results = await inTurn(candidates, CHECKS_AT_ONCE, async (candidate): Promise<PageCheckResult> => {
    const { pricePageUrl, website } = candidate;
    if (candidate.checksAllowedAt === null || pricePageUrl === null || website === null
      || pricePageRefusal(pricePageUrl, website) !== null) {
      return { competitorId: candidate.id, outcome: "not_allowed", nextCheckAfter: null };
    }
    const [claimed] = await db.update(competitorVenues)
      .set({ nextCheckAfter: new Date(now.getTime() + CLAIM_MS) })
      .where(and(
        eq(competitorVenues.id, candidate.id),
        eq(competitorVenues.venueId, candidate.venueId),
        isNull(competitorVenues.removedAt),
        isNotNull(competitorVenues.checksAllowedAt),
        eq(competitorVenues.pricePageUrl, pricePageUrl),
        or(isNull(competitorVenues.nextCheckAfter), lte(competitorVenues.nextCheckAfter, now)),
      ))
      .returning({ pageHash: competitorVenues.pageHash });
    if (claimed === undefined) {
      return { competitorId: candidate.id, outcome: "not_due", nextCheckAfter: iso(candidate.nextCheckAfter) };
    }

    const answer = await checkPage({ fetcher: options.fetcher, pageUrl: pricePageUrl, website, previousHash: claimed.pageHash });
    const next = nextCheckAfter(now, answer.outcome);
    await db.transaction(async (tx) => {
      // The read took time. If a person changed the page's address, stopped
      // the check or removed the venue meanwhile, the answer belongs to the
      // old page: it is logged, but never set on the venue as its page's
      // state, so a new address never inherits the old page's text.
      await tx.update(competitorVenues).set({
        pageCheckedAt: now,
        pageCheckOutcome: answer.outcome,
        pageCheckStatus: answer.httpStatus,
        nextCheckAfter: next,
        ...(answer.hash === null ? {} : { pageHash: answer.hash }),
        ...(answer.outcome === "changed" ? { pageChangedAt: now } : {}),
      }).where(and(
        eq(competitorVenues.id, candidate.id),
        eq(competitorVenues.venueId, candidate.venueId),
        isNull(competitorVenues.removedAt),
        isNotNull(competitorVenues.checksAllowedAt),
        eq(competitorVenues.pricePageUrl, pricePageUrl),
      ));
      await tx.insert(competitorPageChecks).values({
        venueId: candidate.venueId,
        competitorId: candidate.id,
        checkedAt: now,
        url: pricePageUrl,
        robots: answer.robots,
        outcome: answer.outcome,
        httpStatus: answer.httpStatus,
        contentHash: answer.hash,
        runBy: options.runBy,
        triggeredBy: options.triggeredBy,
      });
    });
    return { competitorId: candidate.id, outcome: answer.outcome, nextCheckAfter: next.toISOString() };
  });

  return { checkedAt: now.toISOString(), results };
}
