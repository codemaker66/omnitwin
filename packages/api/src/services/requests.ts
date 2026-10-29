import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import {
  STAFF_AUDIENCE_ROLES,
  UserRoleSchema,
  describeRequestKind,
  describeRequestOutcome,
  describeRequestUrgency,
  escalationWindowSeconds,
  isClientSideRole,
  isOfficeRole,
  nextRequestState,
  summariseRequest,
  type ClientCreateRequest,
  type CreateVenueRequest,
  type RequestListQuery,
  type RequestState,
  type RequestTransition,
  type ThreadAudience,
  type VenueHandler,
  type VenueRequest,
} from "@omnitwin/types";
import {
  bookings,
  eventPlanNotifications,
  events,
  requestStatusHistory,
  requests,
  spaces,
  users,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canHandleRequests, canManageVenue } from "../utils/query.js";
import { clientHoldsEventLink, createRequestThread, postSystemMessage } from "./conversations.js";
import { sendEmail, type EmailPayload, type SendOptions } from "./email.js";
import { requestEscalation } from "./email-templates.js";
import { withinQuietHours } from "./escalation-clock.js";
import { readOperatingSettings } from "./venue-operating-settings.js";
import { pokeEscalationScheduler } from "./escalation-wake.js";

// ---------------------------------------------------------------------------
// Requests — the core (Ship Friday slice 10, widened by goal 19 S1).
//
// Everything that decides anything lives here; the route files parse, call,
// and shape a reply. The guarantees the routes cannot provide on their own:
//
//   TENANCY. Every read and every write is scoped by the venue on the ROW,
//   not by the venue the caller claims. `canManageVenue` is the same helper
//   the rest of the house uses, so a widened role list widens this with it.
//
//   THE AUDIENCE IS FIXED AT CREATION. It is written once, from the staff
//   roles the product knows at that moment, and no function here ever writes
//   that column again. Reads filter on the STORED list, so a role added to
//   the product next week cannot see a request made today. A client sees
//   only the requests they raised, through their own event and its link.
//
//   THE UNIQUE INDEX IS THE IDEMPOTENCY GUARD. Not a SELECT-then-INSERT: the
//   insert carries ON CONFLICT DO NOTHING against
//   requests(venue_id, idempotency_key), and a losing writer re-reads the
//   winner's committed row. The same press replayed on a flaky phone signal
//   gets the same request back, not a second one.
//
//   THE LADDER IS APPLIED IN THE UPDATE'S OWN WHERE CLAUSE. The state the
//   caller saw is part of the predicate, so if somebody else moved the
//   request in the meantime the update matches nothing and the caller is told
//   calmly rather than silently overwriting their colleague. Two accepts at
//   once leave exactly one owner, and the loser is told who has it.
//
//   EVERY REQUEST HAS A THREAD, made in the same transaction: staff-private
//   when the floor asked, client-facing when the client did. Every step is
//   recorded there as a system message, so "Elaine has this" reaches the
//   person who asked without a second mechanism.
//
// Escalation is DATA: the window comes from the venue's `venue_settings` row.
// A venue with no row never escalates — there is no fallback constant, by
// design, so the people matrix replaces data rather than code.
// ---------------------------------------------------------------------------

export type RequestActor = Pick<JwtUser, "id" | "name" | "role" | "venueId" | "platformRole">;

export interface RequestDeny {
  readonly ok: false;
  readonly status: number;
  readonly error: string;
  readonly code: string;
  /** On REQUEST_TAKEN and NOT_OWNER: who has it, so the screen can say so. */
  readonly ownerName?: string;
}

type RequestRow = typeof requests.$inferSelect;
type AudienceRole = typeof eventPlanNotifications.$inferInsert["audienceRole"];
/** The surface both a Database and a transaction expose. */
type Conn = Pick<Database, "select" | "insert" | "update">;

function deny(status: number, code: string, error: string, ownerName?: string): RequestDeny {
  return ownerName === undefined ? { ok: false, status, code, error } : { ok: false, status, code, error, ownerName };
}

const FORBIDDEN = deny(403, "FORBIDDEN", "This request belongs to another venue's floor.");
const NOT_FOUND = deny(404, "NOT_FOUND", "That request no longer exists.");

/** ISO-8601 with offset, the wire format every instant uses here. */
function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function serializeRequest(row: RequestRow, roomName: string | null): VenueRequest {
  return {
    id: row.id,
    venueId: row.venueId,
    bookingId: row.bookingId,
    eventId: row.eventId,
    roomId: row.roomId,
    roomName,
    kind: row.kind,
    quantity: row.quantity,
    urgency: row.urgency,
    detail: row.detail,
    requestedByUserId: row.requestedByUserId,
    requestedByName: row.requestedByName,
    requestedByRole: row.requestedByRole,
    audienceRoles: [...row.audienceRoles] as VenueRequest["audienceRoles"],
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    state: row.state,
    outcome: row.outcome ?? null,
    outcomeNote: row.outcomeNote,
    escalationDueAt: iso(row.escalationDueAt),
    escalatedAt: iso(row.escalatedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
    acceptedAt: iso(row.acceptedAt),
    resolvedAt: iso(row.resolvedAt),
    threadId: row.threadId,
    handoverToUserId: row.handoverToUserId,
    handoverToName: row.handoverToName,
    handedOverAt: iso(row.handedOverAt),
    handoverDueAt: iso(row.handoverDueAt),
    underwayAt: iso(row.underwayAt),
    reopenedAt: iso(row.reopenedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Can this person see requests written for this audience? Platform admins
 *  read everything in the venue; everybody else must be IN the list that was
 *  fixed when the request was made. The client who asked sees their own. */
export function canSeeRequest(
  actor: RequestActor,
  row: Pick<RequestRow, "venueId" | "audienceRoles" | "requestedByUserId">,
): boolean {
  if (isPlatformAdmin(actor)) return true;
  if (isClientSideRole(actor.role)) return row.requestedByUserId === actor.id;
  if (!canManageVenue(actor, row.venueId)) return false;
  return row.audienceRoles.includes(actor.role);
}

/** The audience a new request is given: every staff role the product knows
 *  about right now, derived from USER_ROLES rather than hand-listed. */
export function audienceForNewRequest(): readonly string[] {
  return [...STAFF_AUDIENCE_ROLES];
}

async function roomNameFor(db: Conn, roomId: string): Promise<string | null> {
  const [room] = await db
    .select({ name: spaces.name })
    .from(spaces)
    .where(eq(spaces.id, roomId))
    .limit(1);
  return room?.name ?? null;
}

// ---------------------------------------------------------------------------
// Notifications — the inbox copy of a request, one row per audience role so
// the existing /notifications surface (and its unread count) carries requests
// without a second delivery mechanism.
// ---------------------------------------------------------------------------

const DAY_BOARD_PATH = "/hallkeeper/today";

interface NotificationSeed {
  readonly venueId: string;
  readonly eventId: string | null;
  readonly audienceRole: AudienceRole;
  readonly recipientUserId: string | null;
  readonly title: string;
  readonly body: string;
  readonly severity: "info" | "attention" | "urgent";
}

async function insertNotifications(
  tx: Pick<Database, "insert">,
  seeds: readonly NotificationSeed[],
): Promise<readonly string[]> {
  if (seeds.length === 0) return [];
  const inserted = await tx
    .insert(eventPlanNotifications)
    .values(seeds.map((seed) => ({
      eventId: seed.eventId,
      venueId: seed.venueId,
      audienceRole: seed.audienceRole,
      recipientUserId: seed.recipientUserId,
      title: seed.title,
      body: seed.body,
      severity: seed.severity,
      actionPath: DAY_BOARD_PATH,
    })))
    .returning({ id: eventPlanNotifications.id });
  return inserted.map((row) => row.id);
}

function requestNotificationBody(row: {
  readonly requestedByName: string;
  readonly urgency: RequestRow["urgency"];
  readonly detail: string | null;
}): string {
  const head = `${row.requestedByName} asked · ${describeRequestUrgency(row.urgency)}`;
  return row.detail === null || row.detail.length === 0 ? head : `${head} — ${row.detail}`;
}

/** The first message of a request's thread: the ask, in the asker's words. */
function requestOpeningBody(row: {
  readonly kind: RequestRow["kind"];
  readonly quantity: number | null;
  readonly urgency: RequestRow["urgency"];
  readonly detail: string | null;
}): string {
  const head = `${summariseRequest({ kind: row.kind, quantity: row.quantity })} · ${describeRequestUrgency(row.urgency)}`;
  return row.detail === null || row.detail.length === 0 ? head : `${head}\n${row.detail}`;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateRequestOk {
  readonly ok: true;
  /** True when the idempotency key had already been used: the SAME request
   *  comes back, nothing was written, and nothing is announced twice. */
  readonly replay: boolean;
  readonly request: VenueRequest;
  readonly notificationIds: readonly string[];
}

interface RequestSeed {
  readonly venueId: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly bookingId: string | null;
  readonly eventId: string | null;
  readonly kind: RequestRow["kind"];
  readonly quantity: number | null;
  readonly urgency: RequestRow["urgency"];
  readonly detail: string | null;
  readonly idempotencyKey: string;
  readonly audience: ThreadAudience;
}

/** The insert both doors share: the row, its first step of history, the
 *  inbox copies and the thread, in one transaction. */
async function insertRequest(db: Database, actor: RequestActor, seed: RequestSeed): Promise<CreateRequestOk | RequestDeny> {
  // Every urgency has its own window now (goal 19 S7); a venue with no
  // settings row still has none and never escalates.
  const settings = await readOperatingSettings(db, seed.venueId);
  const audienceRoles = audienceForNewRequest();
  const now = new Date();
  const escalationDueAt = settings === null
    ? null
    : new Date(now.getTime() + escalationWindowSeconds(settings, seed.urgency) * 1000);

  const outcome = await db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(requests)
      .values({
        venueId: seed.venueId,
        bookingId: seed.bookingId,
        eventId: seed.eventId,
        roomId: seed.roomId,
        kind: seed.kind,
        quantity: seed.quantity,
        urgency: seed.urgency,
        detail: seed.detail,
        requestedByUserId: actor.id,
        requestedByName: actor.name,
        requestedByRole: actor.role,
        audienceRoles,
        state: "sent",
        idempotencyKey: seed.idempotencyKey,
        escalationDueAt,
        createdAt: now,
        updatedAt: now,
      })
      // The index decides, not a prior read: a second press of the same
      // button writes nothing and reads the winner back.
      .onConflictDoNothing({ target: [requests.venueId, requests.idempotencyKey] })
      .returning();

    const fresh = insertedRows[0];
    if (fresh === undefined) {
      const [existing] = await tx
        .select()
        .from(requests)
        .where(and(eq(requests.venueId, seed.venueId), eq(requests.idempotencyKey, seed.idempotencyKey)))
        .limit(1);
      return { replay: true as const, row: existing ?? null, notificationIds: [] as readonly string[] };
    }

    await tx.insert(requestStatusHistory).values({
      requestId: fresh.id,
      fromState: null,
      toState: "sent",
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      note: null,
      at: now,
    });

    const title = summariseRequest({ kind: fresh.kind, quantity: fresh.quantity, roomName: seed.roomName });
    const notificationIds = await insertNotifications(tx, audienceRoles.map((role) => ({
      venueId: seed.venueId,
      eventId: fresh.eventId,
      audienceRole: role as AudienceRole,
      recipientUserId: null,
      title,
      body: requestNotificationBody(fresh),
      severity: fresh.urgency === "now" ? "urgent" as const : "attention" as const,
    })));

    // The request's conversation, with the ask as its first message.
    const threadId = await createRequestThread(tx, {
      venueId: seed.venueId,
      audience: seed.audience,
      requestId: fresh.id,
      bookingId: fresh.bookingId,
      eventId: fresh.eventId,
      title,
      author: { userId: actor.id, name: actor.name, role: actor.role },
      body: requestOpeningBody(fresh),
      idempotencyKey: seed.idempotencyKey,
    });
    const [linked] = await tx
      .update(requests)
      .set({ threadId })
      .where(eq(requests.id, fresh.id))
      .returning();

    return { replay: false as const, row: linked ?? fresh, notificationIds };
  });

  if (outcome.row === null) {
    // The conflicting row vanished between the insert and the re-read — only
    // possible if it was deleted in that instant. Say so rather than guess.
    return deny(409, "REQUEST_RACE", "That request could not be read back — try again.");
  }

  // A new window to wake for (S7); a replay changes nothing.
  if (!outcome.replay) pokeEscalationScheduler();
  return {
    ok: true,
    replay: outcome.replay,
    request: serializeRequest(outcome.row, seed.roomName),
    notificationIds: outcome.notificationIds,
  };
}

/** The floor's door: a request raised by somebody who works the venue. */
export async function createRequestCore(
  db: Database,
  actor: RequestActor,
  venueId: string,
  input: CreateVenueRequest,
): Promise<CreateRequestOk | RequestDeny> {
  if (!canManageVenue(actor, venueId)) return FORBIDDEN;

  const [room] = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(and(eq(spaces.id, input.roomId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
    .limit(1);
  if (room === undefined) {
    return deny(400, "ROOM_NOT_IN_VENUE", "That room is not one of this venue's rooms.");
  }

  const bookingId = input.bookingId ?? null;
  if (bookingId !== null) {
    const [booking] = await db
      .select({ id: bookings.id, eventId: bookings.eventId })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.venueId, venueId)))
      .limit(1);
    if (booking === undefined) {
      return deny(400, "BOOKING_NOT_IN_VENUE", "That booking is not in this venue's diary.");
    }
    if (input.eventId !== undefined && input.eventId !== null && booking.eventId !== input.eventId) {
      return deny(400, "BOOKING_NOT_ON_EVENT", "That booking is not part of that event.");
    }
  }

  const eventId = input.eventId ?? null;
  if (eventId !== null) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.venueId, venueId), isNull(events.deletedAt)))
      .limit(1);
    if (event === undefined) {
      return deny(400, "EVENT_NOT_IN_VENUE", "That event is not one of this venue's events.");
    }
  }

  return insertRequest(db, actor, {
    venueId,
    roomId: room.id,
    roomName: room.name,
    bookingId,
    eventId,
    kind: input.kind,
    quantity: input.quantity ?? null,
    urgency: input.urgency,
    detail: input.detail ?? null,
    idempotencyKey: input.idempotencyKey,
    audience: "staff-private",
  });
}

/** The client's door: a request raised on their own event, about one of its
 *  slots. The room is the booking's; the venue is the booking's; the link is
 *  proved against the rows every time. */
export async function createClientRequestCore(
  db: Database,
  actor: RequestActor,
  eventId: string,
  input: ClientCreateRequest,
): Promise<CreateRequestOk | RequestDeny> {
  if (!isClientSideRole(actor.role) && !isPlatformAdmin(actor)) {
    return deny(403, "FORBIDDEN", "Only the event's client asks here.");
  }
  const [slot] = await db
    .select({ booking: bookings, roomName: spaces.name })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(and(eq(bookings.id, input.bookingId), isNull(bookings.deletedAt)))
    .limit(1);
  if (slot === undefined || slot.booking.eventId !== eventId) {
    return deny(400, "BOOKING_NOT_ON_EVENT", "That booking is not part of your event.");
  }
  if (!isPlatformAdmin(actor) && !(await clientHoldsEventLink(db, actor.id, eventId))) {
    return deny(403, "FORBIDDEN", "This event is not linked to your account.");
  }

  return insertRequest(db, actor, {
    venueId: slot.booking.venueId,
    roomId: slot.booking.spaceId,
    roomName: slot.roomName,
    bookingId: slot.booking.id,
    eventId,
    kind: input.kind,
    quantity: input.quantity ?? null,
    urgency: input.urgency,
    detail: input.detail ?? null,
    idempotencyKey: input.idempotencyKey,
    audience: "client-facing",
  });
}

// ---------------------------------------------------------------------------
// Move it along
// ---------------------------------------------------------------------------

export interface TransitionRequestOk {
  readonly ok: true;
  readonly request: VenueRequest;
  readonly fromState: RequestState;
}

/** What the thread records for each step, in the words the client reads. */
function stepMessage(
  actor: RequestActor,
  transition: RequestTransition,
  targetName: string | null,
): string {
  switch (transition.to) {
    case "acknowledged": return `${actor.name} has seen this.`;
    case "accepted": return `${actor.name} has this.`;
    case "underway": return `${actor.name} is on it.`;
    case "handed-over": return `${actor.name} handed this to ${targetName ?? "a colleague"}.`;
    case "resolved": {
      const note = transition.note ?? null;
      return note === null ? `${describeRequestOutcome(transition.outcome)}.` : `${describeRequestOutcome(transition.outcome)}: ${note}`;
    }
    case "reopened": {
      const note = transition.note ?? null;
      return note === null ? `Reopened by ${actor.name}.` : `Reopened by ${actor.name}: ${note}`;
    }
    default: {
      const exhausted: never = transition;
      throw new Error(`Unhandled transition ${String(exhausted)}`);
    }
  }
}

function hasOwner(row: Pick<RequestRow, "state" | "ownerUserId" | "ownerName">): row is RequestRow & { readonly ownerName: string } {
  return row.ownerUserId !== null && row.ownerName !== null && (row.state === "accepted" || row.state === "underway");
}

export async function transitionRequestCore(
  db: Database,
  actor: RequestActor,
  requestId: string,
  transition: RequestTransition,
): Promise<TransitionRequestOk | RequestDeny> {
  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (row === undefined) return NOT_FOUND;

  // Who may move it. The floor handles; the client who asked may reopen
  // their own, and only while their link is live.
  if (isClientSideRole(actor.role) && !isPlatformAdmin(actor)) {
    if (transition.to !== "reopened" || row.requestedByUserId !== actor.id) return FORBIDDEN;
    if (row.eventId === null || !(await clientHoldsEventLink(db, actor.id, row.eventId))) return FORBIDDEN;
  } else if (!isPlatformAdmin(actor)) {
    if (!canSeeRequest(actor, row) || !canHandleRequests(actor, row.venueId)) return FORBIDDEN;
  }

  // Somebody already has it: the second "I'll take this" is told who, by
  // name, whether it arrives a second or a minute after the first.
  if (transition.to === "accepted" && hasOwner(row) && row.ownerUserId !== actor.id) {
    return deny(409, "REQUEST_TAKEN", `${row.ownerName} has this.`, row.ownerName);
  }

  const check = nextRequestState(row.state, transition.to);
  if (!check.ok) return deny(409, "REQUEST_STATE_CONFLICT", check.reason);

  const senior = isPlatformAdmin(actor) || isOfficeRole(actor.role);
  const ownsIt = row.ownerUserId === actor.id;

  // Steps only the owner takes (or the office, on their behalf).
  if ((transition.to === "underway" || transition.to === "handed-over") && !ownsIt && !senior) {
    return deny(409, "NOT_OWNER", `${row.ownerName ?? "Somebody else"} has this.`, row.ownerName ?? undefined);
  }
  // A handover in flight may be accepted only by the person it was handed
  // to, or taken back by the owner of record when the relief never came.
  if (transition.to === "accepted" && row.state === "handed-over" && row.handoverToUserId !== actor.id && !ownsIt && !isPlatformAdmin(actor)) {
    return deny(
      409,
      "HANDOVER_NAMED_SOMEONE_ELSE",
      `This was handed to ${row.handoverToName ?? "a colleague"}; only they can take it.`,
      row.handoverToName ?? undefined,
    );
  }

  let target: { readonly id: string; readonly name: string } | null = null;
  if (transition.to === "handed-over") {
    if (transition.toUserId === actor.id) {
      return deny(400, "HANDOVER_TO_SELF", "You already have this.");
    }
    const [person] = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.id, transition.toUserId), eq(users.venueId, row.venueId)))
      .limit(1);
    if (person === undefined || !canHandleRequests({ role: person.role, venueId: row.venueId, platformRole: "none" }, row.venueId)) {
      return deny(400, "HANDOVER_TARGET", "That person does not work this venue's floor.");
    }
    target = { id: person.id, name: person.name };
  }

  const now = new Date();
  const patch: Partial<typeof requests.$inferInsert> = { state: transition.to, updatedAt: now };
  switch (transition.to) {
    case "acknowledged":
      patch.acknowledgedAt = now;
      break;
    case "accepted":
      patch.acceptedAt = now;
      patch.ownerUserId = actor.id;
      patch.ownerName = actor.name;
      patch.handoverToUserId = null;
      patch.handoverToName = null;
      patch.handoverDueAt = null;
      break;
    case "underway":
      patch.underwayAt = now;
      break;
    case "handed-over": {
      patch.handedOverAt = now;
      patch.handoverToUserId = target?.id ?? null;
      patch.handoverToName = target?.name ?? null;
      // The relief has the venue's window to take it, or it escalates (S7);
      // a venue with no settings row sets no deadline, as with every window.
      const settings = await readOperatingSettings(db, row.venueId);
      patch.handoverDueAt = settings === null ? null : new Date(now.getTime() + settings.handoverReliefSeconds * 1000);
      // An earlier escalation (while unowned, or an earlier relief) is spent:
      // an absent relief escalates this handover on its own (people matrix §2).
      patch.escalatedAt = null;
      patch.escalationEmailedAt = null;
      break;
    }
    case "resolved":
      patch.resolvedAt = now;
      patch.outcome = transition.outcome;
      patch.outcomeNote = transition.note ?? null;
      patch.handoverToUserId = null;
      patch.handoverToName = null;
      patch.handoverDueAt = null;
      if (row.ownerUserId === null) {
        patch.ownerUserId = actor.id;
        patch.ownerName = actor.name;
      }
      break;
    case "reopened": {
      // The outcome is history now; the request needs an owner again, and
      // nobody has it, so it escalates like a new one if nobody takes it:
      // the venue's window for its urgency, from now. An earlier escalation
      // is spent, as on a handover; the email key is per escalation.
      const settings = await readOperatingSettings(db, row.venueId);
      patch.escalationDueAt = settings === null ? null : new Date(now.getTime() + escalationWindowSeconds(settings, row.urgency) * 1000);
      patch.escalatedAt = null;
      patch.escalationEmailedAt = null;
      patch.reopenedAt = now;
      patch.outcome = null;
      patch.outcomeNote = null;
      patch.ownerUserId = null;
      patch.ownerName = null;
      patch.acceptedAt = null;
      patch.underwayAt = null;
      patch.resolvedAt = null;
      patch.handoverToUserId = null;
      patch.handoverToName = null;
      patch.handoverDueAt = null;
      break;
    }
    default: {
      const exhausted: never = transition;
      throw new Error(`Unhandled transition ${String(exhausted)}`);
    }
  }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(requests)
      .set(patch)
      // The state the caller saw is part of the predicate. A colleague who
      // moved it first wins, and this caller is told — never overwritten.
      .where(and(eq(requests.id, requestId), eq(requests.state, row.state)))
      .returning();

    const fresh = rows[0];
    if (fresh === undefined) return null;

    await tx.insert(requestStatusHistory).values({
      requestId,
      fromState: row.state,
      toState: transition.to,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      outcome: transition.to === "resolved" ? transition.outcome : null,
      note: transition.to === "resolved" || transition.to === "reopened" ? transition.note ?? null : null,
      at: now,
    });
    if (fresh.threadId !== null) {
      await postSystemMessage(tx, fresh.threadId, stepMessage(actor, transition, target?.name ?? null));
    }
    return fresh;
  });

  if (updated === null) {
    // Somebody moved it first. If they took it, say who: the loser of a
    // double accept needs a name, not a shrug.
    const [current] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    if (transition.to === "accepted" && current !== undefined && hasOwner(current) && current.ownerUserId !== actor.id) {
      return deny(409, "REQUEST_TAKEN", `${current.ownerName} has this.`, current.ownerName);
    }
    return deny(
      409,
      "REQUEST_STATE_CONFLICT",
      "Somebody else moved this request a moment ago — open it again to see where it is.",
    );
  }

  // A handover sets a relief deadline to wake for (S7), a reopen a window.
  if (transition.to === "handed-over" || transition.to === "reopened") pokeEscalationScheduler();
  const roomName = await roomNameFor(db, updated.roomId);
  return { ok: true, request: serializeRequest(updated, roomName), fromState: row.state };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface HandoverShiftOk {
  readonly ok: true;
  readonly handedOver: readonly VenueRequest[];
  /** Requests that had moved on between the reading and the step (a colleague
   *  resolved one, say); each is left as it is and the person is told. */
  readonly refused: number;
  readonly toName: string;
}

/** Refusals about one request rather than the handover itself. */
const PER_REQUEST_REFUSALS: ReadonlySet<string> = new Set(["REQUEST_STATE_CONFLICT", "REQUEST_TAKEN", "NOT_OWNER", "NOT_FOUND", "REQUEST_RACE"]);

/** Goal 19 S7: every open request the actor holds (accepted or underway)
 *  at the venue, handed to one named relief through the same step the slab
 *  takes one at a time, so every rule of that step holds here too: the
 *  relief must work this floor, each request stays the actor's until the
 *  relief takes it, and each escalates if the relief does not. A request
 *  that moved on meanwhile is left as it is and counted; a refusal about
 *  the relief or the floor stops the handover with nothing moved. */
export async function handoverShiftCore(
  db: Database,
  actor: RequestActor,
  venueId: string,
  toUserId: string,
): Promise<HandoverShiftOk | RequestDeny> {
  if (!isPlatformAdmin(actor) && !canHandleRequests(actor, venueId)) return FORBIDDEN;
  const held = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(
      eq(requests.venueId, venueId),
      eq(requests.ownerUserId, actor.id),
      inArray(requests.state, ["accepted", "underway"]),
    ))
    .orderBy(asc(requests.createdAt))
    .limit(100);
  if (held.length === 0) return deny(400, "NOTHING_TO_HAND_OVER", "You hold no open request.");

  const handedOver: VenueRequest[] = [];
  let refused = 0;
  let toName: string | null = null;
  for (const { id } of held) {
    const moved = await transitionRequestCore(db, actor, id, { to: "handed-over", toUserId });
    if (!moved.ok) {
      if (!PER_REQUEST_REFUSALS.has(moved.code)) return moved;
      refused += 1;
      continue;
    }
    handedOver.push(moved.request);
    toName = moved.request.handoverToName ?? toName;
  }
  if (handedOver.length === 0) return deny(400, "NOTHING_TO_HAND_OVER", "You hold no open request.");
  return { ok: true, handedOver, refused, toName: toName ?? "a colleague" };
}

export async function listRequestsForVenue(
  db: Database,
  actor: RequestActor,
  venueId: string,
  query: RequestListQuery,
): Promise<readonly VenueRequest[] | RequestDeny> {
  if (!canManageVenue(actor, venueId)) return FORBIDDEN;

  const rows = await db
    .select({ request: requests, roomName: spaces.name })
    .from(requests)
    .leftJoin(spaces, eq(spaces.id, requests.roomId))
    .where(and(
      eq(requests.venueId, venueId),
      query.bookingId === undefined ? undefined : eq(requests.bookingId, query.bookingId),
      query.roomId === undefined ? undefined : eq(requests.roomId, query.roomId),
      query.status === "open" ? sql`${requests.state} <> 'resolved'` : undefined,
    ))
    .orderBy(desc(requests.createdAt))
    .limit(query.limit);

  // The audience list on each ROW is the filter — never the caller's claim.
  return rows
    .filter((row) => canSeeRequest(actor, row.request))
    .map((row) => serializeRequest(row.request, row.roomName));
}

/** A client's own asks on their event; the office sees every request on it. */
export async function listRequestsForClientEvent(
  db: Database,
  actor: RequestActor,
  eventId: string,
): Promise<readonly VenueRequest[] | RequestDeny> {
  const office = isPlatformAdmin(actor) || isOfficeRole(actor.role);
  if (!office) {
    if (!isClientSideRole(actor.role)) return FORBIDDEN;
    if (!(await clientHoldsEventLink(db, actor.id, eventId))) return FORBIDDEN;
  }
  const rows = await db
    .select({ request: requests, roomName: spaces.name })
    .from(requests)
    .leftJoin(spaces, eq(spaces.id, requests.roomId))
    .where(and(
      eq(requests.eventId, eventId),
      office ? undefined : eq(requests.requestedByUserId, actor.id),
    ))
    .orderBy(desc(requests.createdAt))
    .limit(200);
  return rows
    .filter((row) => (office ? canSeeRequest(actor, row.request) : true))
    .map((row) => serializeRequest(row.request, row.roomName));
}

/**
 * The people a request can be handed to (goal 19 S4): everyone at the venue
 * whose role may handle one, by name and role only, for the picker on the
 * slab. Each row is admitted by the same test the handover applies to its
 * target, so the picker never offers a name the core would refuse. Only the
 * floor asks; a client never reads the staff list.
 */
export async function listRequestHandlers(
  db: Database,
  actor: RequestActor,
  venueId: string,
): Promise<readonly VenueHandler[] | RequestDeny> {
  if (!canHandleRequests(actor, venueId)) {
    return deny(403, "FORBIDDEN", "Only the floor sees who can take a request.");
  }
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.venueId, venueId))
    .orderBy(asc(users.name), asc(users.id))
    .limit(200);
  const handlers: VenueHandler[] = [];
  for (const row of rows) {
    const role = UserRoleSchema.safeParse(row.role);
    if (!role.success) continue;
    if (!canHandleRequests({ role: role.data, venueId, platformRole: "none" }, venueId)) continue;
    handlers.push({ id: row.id, name: row.name, role: role.data });
  }
  return handlers;
}

export async function readRequest(
  db: Database,
  actor: RequestActor,
  requestId: string,
): Promise<VenueRequest | RequestDeny> {
  const [row] = await db
    .select({ request: requests, roomName: spaces.name })
    .from(requests)
    .leftJoin(spaces, eq(spaces.id, requests.roomId))
    .where(eq(requests.id, requestId))
    .limit(1);
  if (row === undefined) return NOT_FOUND;
  if (!canSeeRequest(actor, row.request)) return FORBIDDEN;
  // A client reads their own requests only while their link to the event is
  // live, as for every other step they take on it (transitionRequestCore).
  if (isClientSideRole(actor.role) && !isPlatformAdmin(actor)
    && (row.request.eventId === null || !(await clientHoldsEventLink(db, actor.id, row.request.eventId)))) {
    return FORBIDDEN;
  }
  return serializeRequest(row.request, row.roomName);
}

// ---------------------------------------------------------------------------
// Escalation — an unanswered "now" request reaches the venue administrator
// after the venue's own window.
//
// Pure selector first, so the rule is testable without a clock or a database;
// the pass then claims each row with a conditional UPDATE (escalated_at IS
// NULL), which means two API processes running the same sweep escalate once
// between them. The email service's own idempotency key does the same for the
// message. That is why a short in-process sweep is safe here where the hold
// reminders needed a cron: the WRITE, not the schedule, is the guard.
// ---------------------------------------------------------------------------

export interface EscalationCandidate {
  readonly id: string;
  readonly state: RequestState;
  readonly urgency: RequestRow["urgency"];
  readonly escalationDueAt: Date | null;
  readonly escalatedAt: Date | null;
  /** When a handed-over request's relief must have accepted by (S7). */
  readonly handoverDueAt: Date | null;
}

/** The states nobody has picked up: SENT, and REOPENED after it was
 *  finished (its owner is cleared). Each escalates at its own window. */
export const UNOWNED_ESCALATING_STATES = ["sent", "reopened"] as const satisfies readonly RequestState[];

function isUnownedEscalating(state: RequestState): boolean {
  return UNOWNED_ESCALATING_STATES.some((unowned) => unowned === state);
}

/** Which candidates are due at `now`, never one escalated already: still
 *  only SENT or REOPENED (nobody has even said they have seen it) and past
 *  its own urgency's window, or HANDED OVER to a relief who has not taken it
 *  by the venue's relief window. */
export function selectDueRequestEscalations<T extends EscalationCandidate>(
  candidates: readonly T[],
  now: Date,
): readonly T[] {
  const nowMs = now.getTime();
  return candidates.filter((candidate) => candidate.escalatedAt === null && (
    (isUnownedEscalating(candidate.state) && candidate.escalationDueAt !== null && candidate.escalationDueAt.getTime() <= nowMs)
    || (candidate.state === "handed-over" && candidate.handoverDueAt !== null && candidate.handoverDueAt.getTime() <= nowMs)
  ));
}

export type EscalationReason = "unowned" | "handover";

export interface EscalatedRequest {
  readonly request: VenueRequest;
  readonly reason: EscalationReason;
  readonly notificationIds: readonly string[];
  /** The administrators the escalation was addressed to, BY NAME. An
   *  escalation's inbox copy is written per person rather than per role, so
   *  the live frame has to be addressed the same way or the number on their
   *  nav sits still until they navigate. */
  readonly recipientUserIds: readonly string[];
  readonly emailedAdmins: number;
  /** True when the venue's quiet hours held the email back; the email pass
   *  sends it when they end, if the request is still unowned. */
  readonly emailDeferred: boolean;
}

export interface DutyAdmin {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** Who an escalation is addressed to: the duty admin the venue named, if
 *  that person is still an administrator or manager of the venue; otherwise
 *  every administrator of the venue, as before. */
export async function dutyAdminsFor(
  db: Database,
  venueId: string,
  settings: { readonly dutyAdminUserId: string | null } | null,
): Promise<readonly DutyAdmin[]> {
  if (settings?.dutyAdminUserId !== null && settings?.dutyAdminUserId !== undefined) {
    const named = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(
        eq(users.id, settings.dutyAdminUserId),
        eq(users.venueId, venueId),
        inArray(users.role, ["admin", "manager"]),
      ))
      .limit(1);
    if (named.length > 0) return named;
  }
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.venueId, venueId), inArray(users.role, ["admin"])))
    .limit(20);
}

function quietHoursOf(settings: { readonly quietHoursStart: string; readonly quietHoursEnd: string } | null): { start: string; end: string } | null {
  return settings === null ? null : { start: settings.quietHoursStart, end: settings.quietHoursEnd };
}

interface EscalationEmailTarget {
  readonly row: RequestRow;
  readonly roomName: string | null;
  readonly admins: readonly DutyAdmin[];
  readonly reason: EscalationReason;
  /** When this escalation claimed the request (its escalated_at). */
  readonly escalatedAt: Date;
}

/** The email key for one escalation of a request to one person. A request
 *  can escalate more than once (unowned, then to a relief who never takes
 *  it), so the claim instant is part of the key: each escalation is emailed
 *  once, however many times any pass runs, and a later one is not lost to
 *  an earlier one's key. */
export function requestEscalationEmailKey(requestId: string, escalatedAt: Date, adminId: string): string {
  return `request-escalation:${requestId}:${String(escalatedAt.getTime())}:${adminId}`;
}

/** The escalation email to each duty admin, one message per person per
 *  escalation however many times any pass runs. */
async function sendEscalationEmails(
  db: Database,
  target: EscalationEmailTarget,
  now: Date,
  deps: EscalationPassDeps,
  send: (payload: EmailPayload, options: SendOptions) => Promise<boolean>,
): Promise<number> {
  const dayBoardUrl = `${deps.appUrl ?? process.env["APP_URL"] ?? "https://venviewer.com"}${DAY_BOARD_PATH}`;
  let emailedAdmins = 0;
  for (const admin of target.admins) {
    const { subject, html } = await requestEscalation({
      adminName: admin.name,
      kindLabel: describeRequestKind(target.row.kind),
      quantity: target.row.quantity,
      roomName: target.roomName ?? "a room in the building",
      requestedByName: target.row.requestedByName,
      detail: target.row.detail,
      waitingMinutes: Math.max(1, Math.round((now.getTime() - target.row.createdAt.getTime()) / 60_000)),
      dayBoardUrl,
      reason: target.reason,
      handoverToName: target.row.handoverToName,
    });
    const sent = await send({ to: admin.email, subject, html }, {
      db,
      idempotencyKey: requestEscalationEmailKey(target.row.id, target.escalatedAt, admin.id),
      logger: deps.logger,
    });
    if (sent) emailedAdmins += 1;
  }
  return emailedAdmins;
}

export interface EscalationPassDeps {
  readonly now?: Date;
  readonly logger?: FastifyBaseLogger;
  /** Injected for tests; defaults to the house email service. */
  readonly send?: (payload: EmailPayload, options: SendOptions) => Promise<boolean>;
  readonly appUrl?: string;
}

export async function runRequestEscalationPass(
  db: Database,
  deps: EscalationPassDeps = {},
): Promise<readonly EscalatedRequest[]> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendEmail;

  const candidates = await db
    .select()
    .from(requests)
    .where(and(
      isNull(requests.escalatedAt),
      or(
        and(inArray(requests.state, [...UNOWNED_ESCALATING_STATES]), isNotNull(requests.escalationDueAt), lte(requests.escalationDueAt, now)),
        and(eq(requests.state, "handed-over"), isNotNull(requests.handoverDueAt), lte(requests.handoverDueAt, now)),
      ),
    ))
    .limit(100);

  const due = selectDueRequestEscalations(candidates, now);
  const escalated: EscalatedRequest[] = [];
  const settingsByVenue = new Map<string, Awaited<ReturnType<typeof readOperatingSettings>>>();

  for (const candidate of due) {
    // Claim it. A second process (or a second sweep) matches nothing, and
    // neither does a request somebody took between the reading and now.
    const claimed = await db
      .update(requests)
      .set({ escalatedAt: now, updatedAt: now })
      .where(and(eq(requests.id, candidate.id), eq(requests.state, candidate.state), isNull(requests.escalatedAt)))
      .returning();
    const row = claimed[0];
    if (row === undefined) continue;
    const escalatedAt = row.escalatedAt ?? now;

    const reason: EscalationReason = row.state === "handed-over" ? "handover" : "unowned";
    const roomName = await roomNameFor(db, row.roomId);
    let settings = settingsByVenue.get(row.venueId);
    if (settings === undefined) {
      settings = await readOperatingSettings(db, row.venueId);
      settingsByVenue.set(row.venueId, settings);
    }
    const admins = await dutyAdminsFor(db, row.venueId, settings);

    const title = `Still waiting: ${summariseRequest({ kind: row.kind, quantity: row.quantity, roomName })}`;
    const body = reason === "handover"
      ? `${row.ownerName ?? "A colleague"} handed this to ${row.handoverToName ?? "a colleague"}, who has not taken it yet.`
      : row.state === "reopened"
        ? `${row.requestedByName}'s request was reopened and nobody has picked it up yet.`
        : `${row.requestedByName} asked for this ${describeRequestUrgency(row.urgency).toLowerCase()} and nobody has picked it up yet.`;
    const notificationIds = await insertNotifications(db, admins.map((admin) => ({
      venueId: row.venueId,
      eventId: row.eventId,
      audienceRole: "admin" as AudienceRole,
      recipientUserId: admin.id,
      title,
      body,
      severity: "urgent" as const,
    })));

    // Email outside quiet hours only; inside them the inbox copy stands and
    // the email pass sends when they end, if the request is still unowned.
    // The mark is set once every admin's email went; a send that failed
    // leaves it for the email pass to try again (each email is keyed per
    // request and person, so nobody hears twice).
    const quiet = quietHoursOf(settings);
    const emailDeferred = quiet !== null && withinQuietHours(now.getTime(), quiet);
    let emailedAdmins = 0;
    if (!emailDeferred) {
      emailedAdmins = await sendEscalationEmails(db, { row, roomName, admins, reason, escalatedAt }, now, deps, send);
      if (emailedAdmins === admins.length) {
        await db.update(requests).set({ escalationEmailedAt: now }).where(eq(requests.id, row.id));
      }
    }

    deps.logger?.info(
      { event: "request.escalated", requestId: row.id, venueId: row.venueId, reason, admins: admins.length, emailDeferred },
      "request.escalated",
    );
    escalated.push({
      request: serializeRequest(row, roomName),
      reason,
      notificationIds,
      recipientUserIds: admins.map((admin) => admin.id),
      emailedAdmins,
      emailDeferred,
    });
  }

  return escalated;
}

export interface EscalationEmailSent {
  readonly requestId: string;
  readonly venueId: string;
  readonly emailedAdmins: number;
}

/** The emails quiet hours held back: every escalated request whose email
 *  has not left and that is still waiting on somebody (sent, or handed over
 *  and not taken), sent once the venue's quiet hours have ended. The claim
 *  is the conditional UPDATE of escalation_emailed_at; the message key is
 *  the same one the escalation pass uses, so a message never goes twice. */
export async function runEscalationEmailPass(
  db: Database,
  deps: EscalationPassDeps = {},
): Promise<readonly EscalationEmailSent[]> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? sendEmail;

  const waiting = await db
    .select()
    .from(requests)
    .where(and(
      isNotNull(requests.escalatedAt),
      isNull(requests.escalationEmailedAt),
      inArray(requests.state, [...UNOWNED_ESCALATING_STATES, "handed-over"]),
    ))
    .limit(100);

  const sent: EscalationEmailSent[] = [];
  const settingsByVenue = new Map<string, Awaited<ReturnType<typeof readOperatingSettings>>>();
  for (const row of waiting) {
    const escalatedAt = row.escalatedAt;
    if (escalatedAt === null) continue;
    let settings = settingsByVenue.get(row.venueId);
    if (settings === undefined) {
      settings = await readOperatingSettings(db, row.venueId);
      settingsByVenue.set(row.venueId, settings);
    }
    const quiet = quietHoursOf(settings);
    if (quiet !== null && withinQuietHours(now.getTime(), quiet)) continue;

    // Send first, mark after: each email is keyed per request and person in
    // email_sends, so a second process sends nothing twice, and a send that
    // failed is tried again on the next pass instead of being marked done.
    const roomName = await roomNameFor(db, row.roomId);
    const admins = await dutyAdminsFor(db, row.venueId, settings);
    const reason: EscalationReason = row.state === "handed-over" ? "handover" : "unowned";
    const emailedAdmins = await sendEscalationEmails(db, { row, roomName, admins, reason, escalatedAt }, now, deps, send);
    if (emailedAdmins === admins.length) {
      await db.update(requests).set({ escalationEmailedAt: now }).where(and(eq(requests.id, row.id), isNull(requests.escalationEmailedAt)));
    }
    deps.logger?.info(
      { event: "request.escalation_emailed", requestId: row.id, venueId: row.venueId, admins: admins.length, emailedAdmins },
      "request.escalation_emailed",
    );
    sent.push({ requestId: row.id, venueId: row.venueId, emailedAdmins });
  }
  return sent;
}
