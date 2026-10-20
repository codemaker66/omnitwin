import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  SupplierPassBoardSchema,
  SupplierPassDetailsSchema,
  SupplierPassSummarySchema,
  defaultSupplierPassExpiry,
  latestSupplierPassExpiry,
  type SupplierPassBoard,
  type SupplierPassChanges,
  type SupplierPassContact,
  type SupplierPassDetails,
  type SupplierPassSummary,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  bookings,
  configurations,
  events,
  generalAuditLog,
  handoffPacks,
  spaces,
  supplierAcknowledgements,
  supplierCoordinationPackItems,
  supplierCoordinationPacks,
  supplierCoordinationShareTokens,
  supplierInstructions,
  suppliers,
  users,
  venues,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Supplier passes (A Door for Everyone Outside, stage 1).
//
// A pass is a supplier coordination pack with one live link. This module
// holds what the staff "Issue pass" sheet and the supplier's own page read:
// the event's day and rooms from the Diary, the stop date every pass carries,
// the plan a pass was made from and whether the plan has moved on since, and
// what changed in a supplier's part when a fresh pass replaces an earlier one.
//
// Every read here is scoped by venue AND event. A pass is only ever compared
// with an earlier pass for the same venue, the same event and the same
// holder, which is what the cross-scope test
// (supplier-pass-scope-postgres.test.ts) holds the routes to.
// ---------------------------------------------------------------------------

/** Audit actions; the lineage of a fresh pass is read back from these rows. */
export const SUPPLIER_PASS_AUDIT = {
  issued: "supplier_pass.issued",
  replaces: "supplier_pass.replaces",
  withdrawn: "supplier_pass.withdrawn",
  /** A supplier's reply, kept beyond the reach of the pass's cascade. */
  replied: "supplier_pass.replied",
} as const;
export const SUPPLIER_PASS_AUDIT_TARGET = "supplier_coordination_pack";

const LIVE_STATUSES: ReadonlySet<string> = new Set(["issued", "acknowledged", "changes_requested"]);

export interface EventMoments {
  readonly firstAt: Date | null;
  readonly lastAt: Date | null;
  readonly rooms: readonly string[];
}

export const NO_EVENT_MOMENTS: EventMoments = { firstAt: null, lastAt: null, rooms: [] };

/**
 * The event's day and rooms. The Diary's bookings are the authority for when
 * a room is held (events.starts_at is planning metadata that drifts from the
 * Diary, as EventDayOpsPage records); the event's own times stand in only
 * when no live booking names it.
 */
export function eventMomentsFrom(
  event: { readonly startsAt: Date | null; readonly endsAt: Date | null } | null,
  booked: readonly { readonly startsAt: Date; readonly endsAt: Date; readonly room: string }[],
): EventMoments {
  if (booked.length > 0) {
    let firstAt: Date | null = null;
    let lastAt: Date | null = null;
    const rooms: string[] = [];
    for (const row of booked) {
      if (firstAt === null || row.startsAt.getTime() < firstAt.getTime()) firstAt = row.startsAt;
      if (lastAt === null || row.endsAt.getTime() > lastAt.getTime()) lastAt = row.endsAt;
      const room = row.room.trim();
      if (room.length > 0 && !rooms.includes(room) && rooms.length < 12) rooms.push(room);
    }
    return { firstAt, lastAt, rooms };
  }
  if (event === null) return NO_EVENT_MOMENTS;
  return { firstAt: event.startsAt, lastAt: event.endsAt ?? event.startsAt, rooms: [] };
}

export async function readEventMoments(db: Database, eventId: string, venueId: string): Promise<EventMoments> {
  const [event] = await db.select({ startsAt: events.startsAt, endsAt: events.endsAt })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.venueId, venueId), isNull(events.deletedAt)))
    .limit(1);
  const booked = await db.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt, room: spaces.name })
    .from(bookings)
    .innerJoin(spaces, eq(bookings.spaceId, spaces.id))
    .where(and(
      eq(bookings.eventId, eventId),
      eq(bookings.venueId, venueId),
      eq(bookings.status, "active"),
      isNull(bookings.deletedAt),
    ))
    .orderBy(asc(bookings.startsAt));
  return eventMomentsFrom(event ?? null, booked);
}

/**
 * The stop date that applies to a pass. Every pass issued from now on stores
 * one; a pass made before that stored none, and is read as stopping seven
 * days after its event. With neither, the answer is null and the pass does
 * not open: an open-ended link is the risk this rule exists to remove.
 */
export function effectivePassExpiry(
  stored: Date | null,
  eventLastMoment: Date | null,
): { readonly expiresAt: Date | null; readonly assumed: boolean } {
  if (stored !== null) return { expiresAt: stored, assumed: false };
  const fallback = defaultSupplierPassExpiry(eventLastMoment);
  return { expiresAt: fallback, assumed: fallback !== null };
}

/** The newest compiled plan for the event, from a configuration of the same
 *  venue that has not been deleted. */
export async function latestEventHandoff(
  db: Database,
  eventId: string,
  venueId: string,
): Promise<{ readonly id: string; readonly compiledAt: Date } | null> {
  const [row] = await db.select({ id: handoffPacks.id, compiledAt: handoffPacks.compiledAt })
    .from(handoffPacks)
    .innerJoin(configurations, eq(handoffPacks.configId, configurations.id))
    .where(and(
      eq(handoffPacks.eventId, eventId),
      eq(configurations.venueId, venueId),
      isNull(configurations.deletedAt),
      inArray(handoffPacks.status, ["compiled", "exported"]),
    ))
    .orderBy(desc(handoffPacks.compiledAt))
    .limit(1);
  return row ?? null;
}

/** When the plan changed after a pass was made from an earlier one. */
export function planChangedAfter(builtFrom: Date, latest: { readonly compiledAt: Date } | null): Date | null {
  return latest !== null && latest.compiledAt.getTime() > builtFrom.getTime() ? latest.compiledAt : null;
}

function normalisedHolder(title: string): string {
  return title.trim().toLocaleLowerCase("en-GB").replace(/\s+/gu, " ");
}

/**
 * Whether two passes are for the same holder: the same supplier on file, or,
 * when neither names one, the same name on the pass. A fresh pass may only
 * replace one for the same holder, so what changed can never be read across
 * two suppliers.
 */
export function samePassHolder(
  a: { readonly supplierId: string | null; readonly title: string },
  b: { readonly supplierId: string | null; readonly title: string },
): boolean {
  if (a.supplierId !== null || b.supplierId !== null) return a.supplierId === b.supplierId;
  return normalisedHolder(a.title) === normalisedHolder(b.title);
}

interface ComparableItem {
  readonly title: string;
  readonly detail: string;
  readonly arrivalWindow: string | null;
}

/** What changed in a supplier's own part between two briefs, by item title. */
export function itemChanges(
  previous: readonly ComparableItem[],
  current: readonly ComparableItem[],
): Omit<SupplierPassChanges, "since"> {
  const before = new Map(previous.map((item) => [item.title, item]));
  const now = new Map(current.map((item) => [item.title, item]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const item of current) {
    const earlier = before.get(item.title);
    if (earlier === undefined) {
      if (!added.includes(item.title)) added.push(item.title);
    } else if (earlier.detail !== item.detail || earlier.arrivalWindow !== item.arrivalWindow) {
      if (!changed.includes(item.title)) changed.push(item.title);
    }
  }
  const removed: string[] = [];
  for (const item of previous) {
    if (!now.has(item.title) && !removed.includes(item.title)) removed.push(item.title);
  }
  return { added: added.slice(0, 40), removed: removed.slice(0, 40), changed: changed.slice(0, 40) };
}

/** A name and phone a supplier can use, or null; never a malformed one. */
export function passContact(name: string | null | undefined, phone: string | null | undefined): SupplierPassContact | null {
  const cleanName = (name ?? "").trim().slice(0, 200);
  if (cleanName.length === 0) return null;
  const cleanPhone = (phone ?? "").trim();
  return { name: cleanName, phone: cleanPhone.length > 0 && cleanPhone.length <= 40 ? cleanPhone : null };
}

export async function readUserContact(db: Database, userId: string | null): Promise<SupplierPassContact | null> {
  if (userId === null) return null;
  const [user] = await db.select({ name: users.name, displayName: users.displayName, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user === undefined) return null;
  return passContact(user.displayName ?? user.name, user.phone);
}

const LineageMetadata = z.object({ previousPackId: z.string().uuid() }).passthrough();

/**
 * What changed for the holder of a fresh pass: its items against the pass it
 * replaced. The lineage is read from the audit row written when the fresh
 * pass's link was made, and the earlier pass is read only if it belongs to
 * the same venue, the same event and the same holder.
 */
export async function readChangesForHolder(
  db: Database,
  pack: { readonly id: string; readonly venueId: string; readonly eventId: string | null; readonly supplierId: string | null; readonly title: string },
  currentItems: readonly ComparableItem[],
): Promise<SupplierPassChanges | null> {
  if (pack.eventId === null) return null;
  const [lineage] = await db.select({ metadata: generalAuditLog.metadata })
    .from(generalAuditLog)
    .where(and(
      eq(generalAuditLog.action, SUPPLIER_PASS_AUDIT.replaces),
      eq(generalAuditLog.targetType, SUPPLIER_PASS_AUDIT_TARGET),
      eq(generalAuditLog.targetId, pack.id),
    ))
    .orderBy(desc(generalAuditLog.createdAt))
    .limit(1);
  const parsed = LineageMetadata.safeParse(lineage?.metadata ?? null);
  if (!parsed.success) return null;

  const [previous] = await db.select({
    id: supplierCoordinationPacks.id,
    supplierId: supplierCoordinationPacks.supplierId,
    title: supplierCoordinationPacks.title,
    createdAt: supplierCoordinationPacks.createdAt,
  })
    .from(supplierCoordinationPacks)
    .where(and(
      eq(supplierCoordinationPacks.id, parsed.data.previousPackId),
      eq(supplierCoordinationPacks.venueId, pack.venueId),
      eq(supplierCoordinationPacks.eventId, pack.eventId),
    ))
    .limit(1);
  if (previous === undefined || previous.id === pack.id || !samePassHolder(previous, pack)) return null;

  const previousItems = await db.select({
    title: supplierCoordinationPackItems.title,
    detail: supplierCoordinationPackItems.detail,
    arrivalWindow: supplierCoordinationPackItems.arrivalWindow,
  })
    .from(supplierCoordinationPackItems)
    .where(eq(supplierCoordinationPackItems.packId, previous.id))
    .orderBy(supplierCoordinationPackItems.sortOrder);
  return { since: previous.createdAt.toISOString(), ...itemChanges(previousItems, currentItems) };
}

/** The plain words of the supplier's page. */
export async function buildPassDetails(
  db: Database,
  input: {
    readonly pack: {
      readonly id: string;
      readonly venueId: string;
      readonly eventId: string | null;
      readonly supplierId: string | null;
      readonly title: string;
      readonly contactName: string | null;
      readonly createdBy: string | null;
      readonly createdAt: Date;
    };
    readonly builtFromCompiledAt: Date;
    readonly supplierContactName: string | null;
    readonly moments: EventMoments;
    readonly items: readonly ComparableItem[];
  },
): Promise<SupplierPassDetails> {
  const { pack } = input;
  const [venue] = await db.select({ address: venues.address, timezone: venues.timezone })
    .from(venues)
    .where(eq(venues.id, pack.venueId))
    .limit(1);
  const latest = pack.eventId === null ? null : await latestEventHandoff(db, pack.eventId, pack.venueId);
  const [changesForYou, venueContact] = await Promise.all([
    readChangesForHolder(db, pack, input.items),
    readUserContact(db, pack.createdBy),
  ]);
  const address = (venue?.address ?? "").trim();
  return SupplierPassDetailsSchema.parse({
    addressedTo: pack.contactName ?? input.supplierContactName,
    eventStartsAt: input.moments.firstAt?.toISOString() ?? null,
    eventEndsAt: input.moments.lastAt?.toISOString() ?? null,
    rooms: [...input.moments.rooms],
    venueAddress: address.length > 0 ? address.slice(0, 500) : null,
    venueTimeZone: venue?.timezone ?? "Europe/London",
    updatedAt: pack.createdAt.toISOString(),
    planChangedAt: planChangedAfter(input.builtFromCompiledAt, latest)?.toISOString() ?? null,
    changesForYou,
    venueContact,
  });
}

type PackRow = typeof supplierCoordinationPacks.$inferSelect;
type TokenRow = typeof supplierCoordinationShareTokens.$inferSelect;
type AckRow = typeof supplierAcknowledgements.$inferSelect;

/** One pass as the staff board shows it. */
export function summarisePass(
  input: {
    readonly pack: PackRow;
    readonly builtFromCompiledAt: Date;
    readonly supplierName: string | null;
    readonly items: readonly { readonly title: string; readonly arrivalWindow: string | null }[];
    readonly tokens: readonly TokenRow[];
    readonly acknowledgements: readonly AckRow[];
    /** Who made the pass, as its page names them. */
    readonly madeBy?: SupplierPassContact | null;
  },
  context: {
    readonly now: Date;
    readonly eventLastMoment: Date | null;
    readonly latestHandoff: { readonly compiledAt: Date } | null;
  },
): SupplierPassSummary {
  const { pack } = input;
  const { now } = context;
  const expiry = effectivePassExpiry(pack.expiresAt, context.eventLastMoment);
  const tokens = [...input.tokens].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const tokenExpiry = (token: TokenRow): Date | null => token.expiresAt ?? expiry.expiresAt;
  const openLink = tokens.some((token) => {
    const until = tokenExpiry(token);
    return token.revokedAt === null && until !== null && until.getTime() > now.getTime();
  });
  const live = LIVE_STATUSES.has(pack.status)
    && pack.revokedAt === null
    && expiry.expiresAt !== null
    && expiry.expiresAt.getTime() > now.getTime()
    && openLink;
  const newest = tokens[0];
  const viewed = tokens.map((token) => token.lastViewedAt).filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  return SupplierPassSummarySchema.parse({
    id: pack.id,
    title: pack.title,
    supplierId: pack.supplierId,
    supplierName: input.supplierName,
    contactName: pack.contactName,
    contactEmail: pack.contactEmail,
    contactPhone: pack.contactPhone,
    status: pack.status,
    live,
    createdAt: pack.createdAt.toISOString(),
    issuedAt: pack.issuedAt?.toISOString() ?? null,
    expiresAt: expiry.expiresAt?.toISOString() ?? null,
    expiryAssumed: expiry.assumed,
    revokedAt: pack.revokedAt?.toISOString() ?? null,
    builtFromCompiledAt: input.builtFromCompiledAt.toISOString(),
    planChangedAt: planChangedAfter(input.builtFromCompiledAt, context.latestHandoff)?.toISOString() ?? null,
    madeBy: input.madeBy ?? null,
    items: input.items.map((item) => ({ title: item.title, arrivalWindow: item.arrivalWindow })),
    link: newest === undefined ? null : {
      tokenPrefix: newest.tokenPrefix,
      createdAt: newest.createdAt.toISOString(),
      expiresAt: tokenExpiry(newest)?.toISOString() ?? null,
      revokedAt: newest.revokedAt?.toISOString() ?? null,
      lastViewedAt: newest.lastViewedAt?.toISOString() ?? null,
    },
    openedAt: viewed[0]?.toISOString() ?? null,
    acknowledgements: [...input.acknowledgements]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((ack) => ({
        status: ack.status,
        acknowledgedByName: ack.acknowledgedByName,
        note: ack.note,
        createdAt: ack.createdAt.toISOString(),
      })),
  });
}

/** Passes on one event, read for one venue. */
export async function readEventPassSummaries(
  db: Database,
  input: {
    readonly eventId: string;
    readonly venueId: string;
    readonly now: Date;
    readonly eventLastMoment: Date | null;
    readonly latestHandoff: { readonly compiledAt: Date } | null;
    /** Restrict to these passes (one pass after an action). */
    readonly packIds?: readonly string[];
  },
): Promise<SupplierPassSummary[]> {
  const conditions = [
    eq(supplierCoordinationPacks.eventId, input.eventId),
    eq(supplierCoordinationPacks.venueId, input.venueId),
  ];
  if (input.packIds !== undefined) {
    if (input.packIds.length === 0) return [];
    conditions.push(inArray(supplierCoordinationPacks.id, [...input.packIds]));
  }
  const packRows = await db.select({
    pack: supplierCoordinationPacks,
    builtFromCompiledAt: handoffPacks.compiledAt,
    supplierName: suppliers.name,
    makerName: users.name,
    makerDisplayName: users.displayName,
    makerPhone: users.phone,
  })
    .from(supplierCoordinationPacks)
    .innerJoin(handoffPacks, eq(supplierCoordinationPacks.handoffPackId, handoffPacks.id))
    .leftJoin(suppliers, eq(supplierCoordinationPacks.supplierId, suppliers.id))
    .leftJoin(users, eq(supplierCoordinationPacks.createdBy, users.id))
    .where(and(...conditions))
    .orderBy(desc(supplierCoordinationPacks.createdAt));
  if (packRows.length === 0) return [];

  const ids = packRows.map((row) => row.pack.id);
  const [itemRows, tokenRows, ackRows] = await Promise.all([
    db.select().from(supplierCoordinationPackItems)
      .where(inArray(supplierCoordinationPackItems.packId, ids))
      .orderBy(supplierCoordinationPackItems.sortOrder),
    db.select().from(supplierCoordinationShareTokens)
      .where(inArray(supplierCoordinationShareTokens.packId, ids)),
    db.select().from(supplierAcknowledgements)
      .where(inArray(supplierAcknowledgements.packId, ids)),
  ]);

  return packRows.map((row) => summarisePass({
    pack: row.pack,
    builtFromCompiledAt: row.builtFromCompiledAt,
    supplierName: row.supplierName,
    items: itemRows.filter((item) => item.packId === row.pack.id),
    tokens: tokenRows.filter((token) => token.packId === row.pack.id),
    acknowledgements: ackRows.filter((ack) => ack.packId === row.pack.id),
    madeBy: passContact(row.makerDisplayName ?? row.makerName, row.makerPhone),
  }, {
    now: input.now,
    eventLastMoment: input.eventLastMoment,
    latestHandoff: input.latestHandoff,
  }));
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The staff board for one event: what new passes are made from, who can
 *  receive one, and every pass already made. Callers check access first. */
export async function buildSupplierPassBoard(
  db: Database,
  input: {
    readonly event: { readonly id: string; readonly venueId: string };
    readonly canIssue: boolean;
    readonly issuer: SupplierPassContact | null;
    readonly now: Date;
  },
): Promise<SupplierPassBoard> {
  const { event, now } = input;
  const [venue] = await db.select({ name: venues.name, address: venues.address, timezone: venues.timezone })
    .from(venues)
    .where(eq(venues.id, event.venueId))
    .limit(1);
  const [moments, latest] = await Promise.all([
    readEventMoments(db, event.id, event.venueId),
    latestEventHandoff(db, event.id, event.venueId),
  ]);

  const [scopeRows, directory, passes] = await Promise.all([
    latest === null ? Promise.resolve([]) : db.select({
      instructionId: supplierInstructions.id,
      supplierId: supplierInstructions.supplierId,
      category: supplierInstructions.category,
      title: supplierInstructions.title,
      detail: supplierInstructions.detail,
      arrivalWindow: supplierInstructions.arrivalWindow,
    })
      .from(supplierInstructions)
      .where(eq(supplierInstructions.handoffPackId, latest.id))
      .orderBy(supplierInstructions.sortOrder),
    db.select({
      id: suppliers.id,
      name: suppliers.name,
      category: suppliers.category,
      contactName: suppliers.contactName,
      email: suppliers.email,
      phone: suppliers.phone,
    })
      .from(suppliers)
      .where(and(eq(suppliers.venueId, event.venueId), isNull(suppliers.deletedAt)))
      .orderBy(asc(suppliers.name))
      .limit(200),
    readEventPassSummaries(db, {
      eventId: event.id,
      venueId: event.venueId,
      now,
      eventLastMoment: moments.lastAt,
      latestHandoff: latest,
    }),
  ]);

  return SupplierPassBoardSchema.parse({
    eventId: event.id,
    venueName: venue?.name ?? null,
    venueAddress: blankToNull(venue?.address ?? null)?.slice(0, 500) ?? null,
    venueTimeZone: venue?.timezone ?? "Europe/London",
    eventStartsAt: moments.firstAt?.toISOString() ?? null,
    eventLastMomentAt: moments.lastAt?.toISOString() ?? null,
    rooms: [...moments.rooms],
    defaultExpiresAt: defaultSupplierPassExpiry(moments.lastAt)?.toISOString() ?? null,
    latestExpiresAt: latestSupplierPassExpiry(moments.lastAt, now).toISOString(),
    canIssue: input.canIssue,
    handoff: latest === null ? null : { id: latest.id, compiledAt: latest.compiledAt.toISOString() },
    issuer: input.issuer,
    scope: scopeRows,
    suppliers: directory.map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      contactName: blankToNull(entry.contactName),
      email: blankToNull(entry.email),
      phone: blankToNull(entry.phone),
    })),
    passes,
  });
}
