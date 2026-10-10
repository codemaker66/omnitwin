import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import {
  STAFF_AUDIENCE_ROLES,
  UserRoleSchema,
  describeRequestKind,
  describeRequestOutcome,
  describeRequestUrgency,
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
  requestStatusHistory,
  requests,
  spaces,
  users,
  venueSettings,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canHandleRequests, canManageVenue } from "../utils/query.js";
import { clientHoldsEventLink, createRequestThread, postSystemMessage } from "./conversations.js";
import { sendEmail, type EmailPayload, type SendOptions } from "./email.js";
import { requestEscalation } from "./email-templates.js";

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

/** The venue's escalation window in seconds, or null when the venue has not
 *  set one — in which case nothing escalates. */
export async function readEscalationSeconds(db: Database, venueId: string): Promise<number | null> {
  const [row] = await db
    .select({ seconds: venueSettings.requestEscalationSeconds })
    .from(venueSettings)
    .where(eq(venueSettings.venueId, venueId))
    .limit(1);
  return row?.seconds ?? null;
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
  const escalationSeconds = seed.urgency === "now" ? await readEscalationSeconds(db, seed.venueId) : null;
  const audienceRoles = audienceForNewRequest();
  const now = new Date();
  const escalationDueAt = escalationSeconds === null
    ? null
    : new Date(now.getTime() + escalationSeconds * 1000);

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
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.venueId, venueId)))
      .limit(1);
    if (booking === undefined) {
      return deny(400, "BOOKING_NOT_IN_VENUE", "That booking is not in this venue's diary.");
    }
  }

  return insertRequest(db, actor, {
    venueId,
    roomId: room.id,
    roomName: room.name,
    bookingId,
    eventId: input.eventId ?? null,
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
  // A handover in flight may be accepted only by the person it was handed to.
  if (transition.to === "accepted" && row.state === "handed-over" && row.handoverToUserId !== actor.id && !isPlatformAdmin(actor)) {
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
      break;
    case "underway":
      patch.underwayAt = now;
      break;
    case "handed-over":
      patch.handedOverAt = now;
      patch.handoverToUserId = target?.id ?? null;
      patch.handoverToName = target?.name ?? null;
      break;
    case "resolved":
      patch.resolvedAt = now;
      patch.outcome = transition.outcome;
      patch.outcomeNote = transition.note ?? null;
      patch.handoverToUserId = null;
      patch.handoverToName = null;
      if (row.ownerUserId === null) {
        patch.ownerUserId = actor.id;
        patch.ownerName = actor.name;
      }
      break;
    case "reopened":
      // The outcome is history now; the request needs an owner again.
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
      break;
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

  const roomName = await roomNameFor(db, updated.roomId);
  return { ok: true, request: serializeRequest(updated, roomName), fromState: row.state };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

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
}

/** Which candidates are due at `now`: still only SENT (nobody has even said
 *  they have seen it), urgent, past their window, not already escalated. */
export function selectDueRequestEscalations<T extends EscalationCandidate>(
  candidates: readonly T[],
  now: Date,
): readonly T[] {
  return candidates.filter((candidate) =>
    candidate.state === "sent"
    && candidate.urgency === "now"
    && candidate.escalatedAt === null
    && candidate.escalationDueAt !== null
    && candidate.escalationDueAt.getTime() <= now.getTime());
}

export interface EscalatedRequest {
  readonly request: VenueRequest;
  readonly notificationIds: readonly string[];
  /** The administrators the escalation was addressed to, BY NAME. An
   *  escalation's inbox copy is written per person rather than per role, so
   *  the live frame has to be addressed the same way or the number on their
   *  nav sits still until they navigate. */
  readonly recipientUserIds: readonly string[];
  readonly emailedAdmins: number;
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
      eq(requests.state, "sent"),
      eq(requests.urgency, "now"),
      isNull(requests.escalatedAt),
      isNotNull(requests.escalationDueAt),
      lte(requests.escalationDueAt, now),
    ))
    .limit(100);

  const due = selectDueRequestEscalations(candidates, now);
  const escalated: EscalatedRequest[] = [];

  for (const candidate of due) {
    // Claim it. A second process (or a second sweep) matches nothing.
    const claimed = await db
      .update(requests)
      .set({ escalatedAt: now, updatedAt: now })
      .where(and(eq(requests.id, candidate.id), isNull(requests.escalatedAt)))
      .returning();
    const row = claimed[0];
    if (row === undefined) continue;

    const roomName = await roomNameFor(db, row.roomId);
    const admins = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.venueId, row.venueId), inArray(users.role, ["admin"])))
      .limit(20);

    const title = `Still waiting: ${summariseRequest({ kind: row.kind, quantity: row.quantity, roomName })}`;
    const body = `${row.requestedByName} asked for this ${describeRequestUrgency(row.urgency).toLowerCase()} and nobody has picked it up yet.`;
    const notificationIds = await insertNotifications(db, admins.map((admin) => ({
      venueId: row.venueId,
      eventId: row.eventId,
      audienceRole: "admin" as AudienceRole,
      recipientUserId: admin.id,
      title,
      body,
      severity: "urgent" as const,
    })));

    const dayBoardUrl = `${deps.appUrl ?? process.env["APP_URL"] ?? "https://venviewer.com"}${DAY_BOARD_PATH}`;
    let emailedAdmins = 0;
    for (const admin of admins) {
      const { subject, html } = await requestEscalation({
        adminName: admin.name,
        kindLabel: describeRequestKind(row.kind),
        quantity: row.quantity,
        roomName: roomName ?? "a room in the building",
        requestedByName: row.requestedByName,
        detail: row.detail,
        waitingMinutes: Math.max(1, Math.round((now.getTime() - row.createdAt.getTime()) / 60_000)),
        dayBoardUrl,
      });
      const sent = await send({ to: admin.email, subject, html }, {
        db,
        // One escalation, one message, however many times the sweep runs.
        idempotencyKey: `request-escalation:${row.id}:${admin.id}`,
        logger: deps.logger,
      });
      if (sent) emailedAdmins += 1;
    }

    deps.logger?.info(
      { event: "request.escalated", requestId: row.id, venueId: row.venueId, admins: admins.length },
      "request.escalated",
    );
    escalated.push({
      request: serializeRequest(row, roomName),
      notificationIds,
      recipientUserIds: admins.map((admin) => admin.id),
      emailedAdmins,
    });
  }

  return escalated;
}
