import { randomUUID } from "node:crypto";
import {
  TRADES_HALL_ROOM_DIMENSIONS,
  crowdedTradesHallDay,
  type CalendarBookingEntry,
  type CalendarPhaseEntry,
  type CrowdedDay,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// The crowded Trades Hall day, written to a database (L9).
//
// Writes @omnitwin/types' crowdedTradesHallDay() as real rows: a venue of its
// own with the six rooms, the floor's people, the events and their bookings
// (through the bind, as the Diary writes them), the rooms' setup phases, the
// turnaround guidance, the venue's escalation windows, every request with its
// steps of history at the fixture's own times, the facts seen in the rooms and
// the day's suppliers. Every id is fresh, so the day can be written many times
// into one database without a collision; `ids` maps each fixture id to the id
// it was written under, so a test can read the rows back as the fixture.
//
// Requests are inserted rather than made through createRequestCore on
// purpose: the core stamps "now", and the day's requests belong to the day.
// Nothing here sends a notification or a push.
//
// Callers must guard the target: a disposable test database or the named
// local demo database, never a shared or production one.
// ---------------------------------------------------------------------------

export const CROWDED_DAY_FIXTURE_SOURCE = "crowded-day";

export interface SeededCrowdedDay {
  readonly day: CrowdedDay;
  readonly venueId: string;
  /** Fixture id → the id it was written under. */
  readonly ids: ReadonlyMap<string, string>;
  /** The written id of a fixture person, by name. */
  readonly personId: (name: string) => string;
}

/** The galleries publish no dimensions; these are fixture values, drawn nowhere. */
const UNPUBLISHED_ROOM = { lengthM: 12, widthM: 6, heightM: 3.5 } as const;

const WALL_MINUTES = 60_000;

export async function seedCrowdedDay(
  db: Database,
  date?: string,
): Promise<SeededCrowdedDay> {
  const day = crowdedTradesHallDay(date);
  const ids = new Map<string, string>();
  const id = (fixtureId: string): string => {
    const known = ids.get(fixtureId);
    if (known !== undefined) return known;
    const fresh = randomUUID();
    ids.set(fixtureId, fresh);
    return fresh;
  };
  const optionalId = (fixtureId: string | null): string | null => (fixtureId === null ? null : id(fixtureId));
  // A suffix that keeps unique columns unique across many writes of the day.
  const tag = randomUUID().slice(0, 8);
  const venueId = id(day.venue.id);

  await db.insert(schema.venues).values({
    id: venueId,
    name: day.venue.name,
    slug: `${day.venue.slug}-${tag}`,
    address: "Disposable crowded-day fixture",
    timezone: day.timeZone,
  });
  await db.insert(schema.venueSettings).values({
    venueId,
    requestEscalationSeconds: 120,
    escalationNowSeconds: 120,
    escalationSoonSeconds: 300,
    escalationRoutineSeconds: 900,
  });
  await db.insert(schema.spaces).values(day.rooms.map((room) => {
    const size = TRADES_HALL_ROOM_DIMENSIONS[room.slug] ?? UNPUBLISHED_ROOM;
    return {
      id: id(room.id),
      venueId,
      name: room.name,
      slug: room.slug,
      widthM: String(size.widthM),
      lengthM: String(size.lengthM),
      heightM: String(size.heightM),
      floorPlanOutline: [
        { x: 0, y: 0 }, { x: size.lengthM, y: 0 }, { x: size.lengthM, y: size.widthM }, { x: 0, y: size.widthM },
      ],
      sortOrder: room.sortOrder,
    };
  }));
  await db.insert(schema.users).values(day.people.map((person) => ({
    id: id(person.id),
    name: person.name,
    email: person.email.replace("@", `+${tag}@`),
    role: person.role,
    // The client reaches the venue through an event, never as its staff.
    venueId: person.role === "client" ? null : venueId,
  })));

  const admin = day.people.find((person) => person.role === "admin");
  if (admin === undefined) throw new Error("The crowded day has an administrator.");
  const createdBy = id(admin.id);

  const bookings = day.calendar.entries.filter((entry): entry is CalendarBookingEntry => entry.entryType === "booking");
  const phases = day.calendar.entries.filter((entry): entry is CalendarPhaseEntry => entry.entryType === "phase");

  // The events first, spanning their bookings, so each booking joins its own.
  await db.insert(schema.events).values(day.events.map((event) => {
    const own = bookings.filter((entry) => entry.eventId === event.id);
    const starts = Math.min(...own.map((entry) => Date.parse(entry.startsAt)));
    const ends = Math.max(...own.map((entry) => Date.parse(entry.endsAt)));
    return {
      id: id(event.id),
      venueId,
      createdBy,
      name: event.name,
      eventType: event.eventType,
      status: "confirmed",
      startsAt: new Date(starts),
      endsAt: new Date(ends),
      guestCount: event.guestCount,
      clientName: event.clientName,
      fixtureSource: CROWDED_DAY_FIXTURE_SOURCE,
    };
  }));
  await insertBoundBookings(db, bookings.map((entry) => ({
    id: id(entry.id),
    venueId,
    spaceId: id(entry.spaceId),
    eventId: optionalId(entry.eventId),
    kind: entry.kind,
    status: entry.status,
    title: entry.title,
    eventType: entry.eventType,
    startsAt: new Date(entry.startsAt),
    endsAt: new Date(entry.endsAt),
    rank: entry.rank,
    createdBy,
    fixtureSource: CROWDED_DAY_FIXTURE_SOURCE,
  })));
  if (phases.length > 0) {
    await db.insert(schema.eventPhases).values(phases.map((phase) => ({
      id: id(phase.id),
      eventId: id(phase.eventId),
      spaceId: id(phase.spaceId),
      name: phase.name,
      sortOrder: phase.sortOrder,
      startsAt: new Date(phase.startsAt),
      durationMinutes: Math.round((Date.parse(phase.endsAt) - Date.parse(phase.startsAt)) / WALL_MINUTES),
    })));
  }
  await db.insert(schema.turnaroundRules).values((day.calendar.turnaroundRules ?? []).map((rule) => ({
    venueId,
    spaceId: optionalId(rule.spaceId),
    eventType: rule.eventType,
    name: rule.name,
    minutes: rule.minutes,
    isActive: rule.isActive,
  })));

  const personId = (name: string): string => {
    const person = day.people.find((candidate) => candidate.name === name);
    if (person === undefined) throw new Error(`No fixture person called ${name}.`);
    return id(person.id);
  };
  const actorOf = (userId: string | null): { readonly id: string | null; readonly name: string; readonly role: string } => {
    const person = day.people.find((candidate) => candidate.id === userId);
    return person === undefined
      ? { id: null, name: "Someone", role: "staff" }
      : { id: id(person.id), name: person.name, role: person.role };
  };

  await db.transaction(async (tx) => {
    for (const request of day.requests) {
      await tx.insert(schema.requests).values({
        id: id(request.id),
        venueId,
        bookingId: optionalId(request.bookingId),
        eventId: optionalId(request.eventId),
        roomId: id(request.roomId),
        kind: request.kind,
        quantity: request.quantity,
        urgency: request.urgency,
        detail: request.detail,
        requestedByUserId: optionalId(request.requestedByUserId),
        requestedByName: request.requestedByName,
        requestedByRole: request.requestedByRole,
        audienceRoles: request.audienceRoles,
        ownerUserId: optionalId(request.ownerUserId),
        ownerName: request.ownerName,
        state: request.state,
        outcome: request.outcome,
        outcomeNote: request.outcomeNote,
        // The request's own key: the fixture id is unique within the day.
        idempotencyKey: `${CROWDED_DAY_FIXTURE_SOURCE}:${request.id}`,
        escalationDueAt: request.escalationDueAt === null ? null : new Date(request.escalationDueAt),
        escalatedAt: null,
        acknowledgedAt: request.acknowledgedAt === null ? null : new Date(request.acknowledgedAt),
        acceptedAt: request.acceptedAt === null ? null : new Date(request.acceptedAt),
        resolvedAt: request.resolvedAt === null ? null : new Date(request.resolvedAt),
        handoverToUserId: optionalId(request.handoverToUserId),
        handoverToName: request.handoverToName,
        handedOverAt: request.handedOverAt === null ? null : new Date(request.handedOverAt),
        underwayAt: request.underwayAt === null ? null : new Date(request.underwayAt),
        createdAt: new Date(request.createdAt),
        updatedAt: new Date(request.updatedAt),
      });
      // The request's story, step by step, at the fixture's own times: who
      // asked, then whoever moved it (the owner; the floor for a bare "Seen").
      const asker = actorOf(request.requestedByUserId);
      const mover = actorOf(request.ownerUserId);
      const seenBy = request.ownerUserId === null ? actorOf(day.people.find((person) => person.role === "hallkeeper")?.id ?? null) : mover;
      const steps: { readonly toState: typeof request.state; readonly at: string | null; readonly by: ReturnType<typeof actorOf> }[] = [
        { toState: "acknowledged", at: request.acknowledgedAt, by: seenBy },
        { toState: "accepted", at: request.acceptedAt, by: mover },
        { toState: "underway", at: request.underwayAt, by: mover },
        { toState: "handed-over", at: request.handedOverAt, by: mover },
        { toState: "resolved", at: request.resolvedAt, by: mover },
      ];
      const happened = steps.filter((step): step is typeof step & { readonly at: string } => step.at !== null)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const history: (typeof schema.requestStatusHistory.$inferInsert)[] = [{
        requestId: id(request.id), fromState: null, toState: "sent",
        actorUserId: asker.id, actorName: asker.name, actorRole: asker.role, at: new Date(request.createdAt),
      }];
      let fromState: typeof request.state = "sent";
      for (const step of happened) {
        history.push({
          requestId: id(request.id), fromState, toState: step.toState,
          actorUserId: step.by.id, actorName: step.by.name, actorRole: step.by.role,
          outcome: step.toState === "resolved" ? request.outcome : null,
          note: step.toState === "resolved" ? request.outcomeNote : null,
          at: new Date(step.at),
        });
        fromState = step.toState;
      }
      await tx.insert(schema.requestStatusHistory).values(history);
    }
  });

  if (day.observations.length > 0) {
    await db.insert(schema.bookingObservations).values(day.observations.map((fact) => ({
      id: id(fact.id),
      venueId,
      bookingId: id(fact.bookingId),
      spaceId: optionalId(fact.spaceId),
      kind: fact.kind,
      observedAt: new Date(fact.observedAt),
      recordedAt: new Date(fact.recordedAt),
      actorUserId: optionalId(fact.actorUserId),
      actorName: fact.actorName,
      actorRole: fact.actorRole,
      idempotencyKey: id(fact.idempotencyKey),
    })));
  }

  await db.insert(schema.suppliers).values(day.suppliers.map((supplier) => {
    const booking = bookings.find((entry) => entry.id === supplier.bookingId);
    return {
      id: id(supplier.id),
      venueId,
      name: supplier.name,
      category: supplier.category,
      contactName: supplier.contactName,
      email: supplier.email,
      phone: null,
      notes: `Due ${supplier.arrivesAt}–${supplier.leavesBy} for ${booking?.title ?? "the day"}. ${supplier.note}`,
    };
  }));

  return { day, venueId, ids, personId };
}
