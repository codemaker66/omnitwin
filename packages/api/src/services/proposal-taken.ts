import { and, eq, isNull } from "drizzle-orm";
import {
  CanonicalJsonValueSchema,
  sha256Hex,
  stableCanonicalJson,
  type ProposalFacts,
  type ProposalLayoutSnapshot,
  type ProposalNextLayoutChange,
} from "@omnitwin/types";
import { configurations, enquiries, opportunities, spaces, type proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { resolveProposalLayoutSnapshot } from "./proposal-layout-snapshot.js";

// ---------------------------------------------------------------------------
// What a proposal version takes from the proposal when it is saved, rather
// than from the words sent with it: the layout, drawn as it stands, and the
// event's facts as the venue holds them now (roadmap X1). The save and the
// composer's check read it the same way, so what the check says of a save is
// what the save takes.
// ---------------------------------------------------------------------------

type TakenFrom = Pick<typeof proposals.$inferSelect, "venueId" | "opportunityId" | "enquiryId" | "configurationId">;

/**
 * The event the proposal is for, told to its client: the date, how many are
 * coming, the occasion and the room. The room is the layout's, else the one
 * the guest chose on their enquiry; the rest is the deal's, else the
 * enquiry's. Everything is read at the proposal's own venue only.
 */
export async function clientFacts(db: Database, proposal: TakenFrom): Promise<ProposalFacts> {
  const [deal] = proposal.opportunityId === null ? [] : await db.select({
    preferredDate: opportunities.preferredDate,
    guestCount: opportunities.guestCount,
    eventType: opportunities.eventType,
    sourceEnquiryId: opportunities.sourceEnquiryId,
  }).from(opportunities)
    .where(and(eq(opportunities.id, proposal.opportunityId), eq(opportunities.venueId, proposal.venueId), isNull(opportunities.deletedAt)))
    .limit(1);
  const enquiryId = proposal.enquiryId ?? deal?.sourceEnquiryId ?? null;
  const [enquiry] = enquiryId === null ? [] : await db.select({
    preferredDate: enquiries.preferredDate,
    estimatedGuests: enquiries.estimatedGuests,
    eventType: enquiries.eventType,
    spaceId: enquiries.spaceId,
    roomChosen: enquiries.roomChosen,
  }).from(enquiries)
    .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, proposal.venueId)))
    .limit(1);
  const [layoutRoom] = proposal.configurationId === null ? [] : await db.select({ name: spaces.name, slug: spaces.slug })
    .from(configurations)
    .innerJoin(spaces, eq(spaces.id, configurations.spaceId))
    .where(and(
      eq(configurations.id, proposal.configurationId),
      eq(configurations.venueId, proposal.venueId),
      isNull(configurations.deletedAt),
      eq(spaces.venueId, proposal.venueId),
      isNull(spaces.deletedAt),
    ))
    .limit(1);
  // An enquiry filed under a room the guest never chose names no room.
  const [enquiryRoom] = layoutRoom !== undefined || enquiry === undefined || !enquiry.roomChosen ? [] : await db.select({ name: spaces.name, slug: spaces.slug })
    .from(spaces)
    .where(and(eq(spaces.id, enquiry.spaceId), eq(spaces.venueId, proposal.venueId), isNull(spaces.deletedAt)))
    .limit(1);
  const room = layoutRoom ?? enquiryRoom ?? null;
  return {
    eventDate: deal?.preferredDate ?? enquiry?.preferredDate ?? null,
    guestCount: deal?.guestCount ?? enquiry?.estimatedGuests ?? null,
    occasion: deal?.eventType ?? enquiry?.eventType ?? null,
    roomName: room?.name ?? null,
    roomSlug: room?.slug ?? null,
  };
}

export interface TakenAtSave {
  /** Absent with no layout linked; null when the layout has nothing to draw. */
  readonly layoutSnapshot?: ProposalLayoutSnapshot | null;
  readonly facts: ProposalFacts;
}

/** What a version saved now would take from the proposal. */
export async function takenAtSave(db: Database, proposal: TakenFrom): Promise<TakenAtSave> {
  const facts = await clientFacts(db, proposal);
  if (proposal.configurationId === null) return { facts };
  return { layoutSnapshot: await resolveProposalLayoutSnapshot(db, proposal.configurationId, proposal.venueId), facts };
}

// ---------------------------------------------------------------------------
// The drawing, compared as the client's page shows it
// ---------------------------------------------------------------------------

/** A drawing the client's page shows at all: one with a room and a piece in it. */
function shown(snapshot: ProposalLayoutSnapshot | null | undefined): ProposalLayoutSnapshot | null {
  if (snapshot === null || snapshot === undefined) return null;
  return snapshot.items.length > 0 && snapshot.roomWidthM > 0 && snapshot.roomLengthM > 0 ? snapshot : null;
}

/** Whole millimetres, with -0 read as 0. */
function mm(metres: number): number {
  return Math.round(metres * 1000) + 0;
}

/** Tenths of a degree within one turn, so a full turn reads as none. */
function tenths(degrees: number): number {
  return ((Math.round(degrees * 10) % 3600) + 3600) % 3600 + 0;
}

export interface DrawnLayout {
  readonly room: readonly [number, number];
  readonly items: readonly string[];
}

/** The drawing in a form two readings of an untouched layout always share:
 *  millimetres and tenths of a degree, and its pieces as a counted set, as the
 *  layout keeps no order among pieces placed at the same step. */
export function drawnLayout(snapshot: ProposalLayoutSnapshot): DrawnLayout {
  const items = snapshot.items.map((item) => [
    item.kind, item.shape, mm(item.xM), mm(item.zM), mm(item.widthM), mm(item.depthM), tenths(item.rotationDeg),
  ].join("|")).sort();
  return { room: [mm(snapshot.roomWidthM), mm(snapshot.roomLengthM)], items };
}

function sameDrawing(a: DrawnLayout, b: DrawnLayout): boolean {
  return a.room[0] === b.room[0] && a.room[1] === b.room[1]
    && a.items.length === b.items.length && a.items.every((item, index) => item === b.items[index]);
}

/** The drawing a version saved now would show, against the one `before`
 *  shows its client. */
export function layoutChange(before: ProposalLayoutSnapshot | null | undefined, after: ProposalLayoutSnapshot | null | undefined): ProposalNextLayoutChange {
  const was = shown(before);
  const now = shown(after);
  if (was === null) return now === null ? "none" : "added";
  if (now === null) return "removed";
  return sameDrawing(drawnLayout(was), drawnLayout(now)) ? "same" : "changed";
}

// ---------------------------------------------------------------------------
// The basis: exactly what a check saw, so a save can be held to it
// ---------------------------------------------------------------------------

export const PROPOSAL_NEXT_BASIS_DOMAIN_PREFIX = "venviewer.proposal-next-basis.v1:";

/** A digest of what a version saved from `basedOn` would take, as the check
 *  compares it: the proposal's links, the drawing and the event's facts. */
export function nextVersionBasis(basedOn: number, proposal: TakenFrom, taken: TakenAtSave): string {
  const drawing = shown(taken.layoutSnapshot);
  const drawn = drawing === null ? null : drawnLayout(drawing);
  const canonical = CanonicalJsonValueSchema.parse({
    basedOn,
    configurationId: proposal.configurationId,
    opportunityId: proposal.opportunityId,
    enquiryId: proposal.enquiryId,
    layout: drawn === null ? null : { room: [...drawn.room], items: [...drawn.items] },
    facts: { ...taken.facts },
  });
  return sha256Hex(`${PROPOSAL_NEXT_BASIS_DOMAIN_PREFIX}${stableCanonicalJson(canonical)}`);
}
