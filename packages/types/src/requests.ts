import { z } from "zod";
import { USER_ROLES, UserRoleSchema, type UserRole } from "./user.js";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Requests — the one-tap ask from the floor (Ship Friday slice 10, gate 22).
//
// A request is a small, honest object: somebody standing in a room asked for
// something, and somebody else is going to do it. It carries WHO asked, WHAT
// they asked for, HOW urgent it is, WHERE (room, and the booking the room is
// holding), and how far the ask has travelled: sent → seen → accepted →
// finished, each step stamped.
//
// Two rules are load-bearing and live here, not in a route:
//
//   AUDIENCE IS FIXED AT CREATION. The set of roles that can see a request is
//   decided once, when it is made, and stored on the row. It is never widened
//   afterwards — a request made in front of a client's caterer does not later
//   become visible to the whole house because somebody's role changed. The
//   staff audience is DERIVED from USER_ROLES, so when the role list grows
//   the derivation grows with it rather than a hand-maintained copy drifting.
//
//   THE LADDER ONLY CLIMBS. sent → acknowledged → accepted → resolved, never
//   backwards, and a resolved request is finished. `nextRequestState` is the
//   single arbiter; the API applies it inside the row's own UPDATE so two
//   phones pressing at once cannot both win.
//
// Chairs and tables (a request that changes the room's furniture) are R2:
// they need the decision object the planner owns, and guessing it here would
// be a promise the rest of the product cannot keep.
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();

export const RequestIdSchema = UUID;
export type RequestId = z.infer<typeof RequestIdSchema>;

export const REQUEST_KINDS = [
  "refreshments",
  "temperature",
  "cleaning",
  "av",
  "access",
  "other",
] as const;
export const RequestKindSchema = z.enum(REQUEST_KINDS);
export type RequestKind = z.infer<typeof RequestKindSchema>;

export const REQUEST_URGENCIES = ["routine", "soon", "now"] as const;
export const RequestUrgencySchema = z.enum(REQUEST_URGENCIES);
export type RequestUrgency = z.infer<typeof RequestUrgencySchema>;

export const REQUEST_STATES = ["sent", "acknowledged", "accepted", "resolved"] as const;
export const RequestStateSchema = z.enum(REQUEST_STATES);
export type RequestState = z.infer<typeof RequestStateSchema>;

export const REQUEST_OUTCOMES = ["done", "not_possible", "no_longer_needed"] as const;
export const RequestOutcomeSchema = z.enum(REQUEST_OUTCOMES);
export type RequestOutcome = z.infer<typeof RequestOutcomeSchema>;

/** Roles that belong to the client's side of the table. Everything else in
 *  USER_ROLES is house staff, so a widened role list widens the audience
 *  without a second list to keep in step. */
export const CLIENT_SIDE_ROLES: readonly UserRole[] = ["client", "planner"];

/** The default audience of a request made by house staff: every staff role
 *  the product knows about at the moment of creation. */
export const STAFF_AUDIENCE_ROLES: readonly UserRole[] = USER_ROLES.filter(
  (role) => !CLIENT_SIDE_ROLES.includes(role),
);

export function isStaffAudienceRole(role: string): boolean {
  return STAFF_AUDIENCE_ROLES.some((staffRole) => staffRole === role);
}

// --- The ladder ------------------------------------------------------------

const ALLOWED_NEXT: Readonly<Record<RequestState, readonly RequestState[]>> = {
  sent: ["acknowledged", "accepted", "resolved"],
  acknowledged: ["accepted", "resolved"],
  accepted: ["resolved"],
  resolved: [],
};

export type RequestTransitionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// --- Words people read -----------------------------------------------------

const KIND_LABELS: Readonly<Record<RequestKind, string>> = {
  refreshments: "Refreshments",
  temperature: "Room temperature",
  cleaning: "Cleaning",
  av: "Sound and screens",
  access: "Access",
  other: "Something else",
};

const URGENCY_LABELS: Readonly<Record<RequestUrgency, string>> = {
  routine: "When you can",
  soon: "Soon",
  now: "Now",
};

const STATE_LABELS: Readonly<Record<RequestState, string>> = {
  sent: "Sent",
  acknowledged: "Seen",
  accepted: "Someone is on it",
  resolved: "Done",
};

const OUTCOME_LABELS: Readonly<Record<RequestOutcome, string>> = {
  done: "Done",
  not_possible: "Could not be done",
  no_longer_needed: "No longer needed",
};

export function describeRequestKind(kind: RequestKind): string {
  return KIND_LABELS[kind];
}

export function describeRequestUrgency(urgency: RequestUrgency): string {
  return URGENCY_LABELS[urgency];
}

export function describeRequestState(state: RequestState): string {
  return STATE_LABELS[state];
}

export function describeRequestOutcome(outcome: RequestOutcome): string {
  return OUTCOME_LABELS[outcome];
}

/** The only place a state change is judged. Same answer on the server, in the
 *  slab, and in a test — the slab greys a button the server would refuse. */
export function nextRequestState(from: RequestState, to: RequestState): RequestTransitionCheck {
  if (from === to) {
    return { ok: false, reason: `This request is already marked “${describeRequestState(to)}”.` };
  }
  if (ALLOWED_NEXT[from].includes(to)) return { ok: true };
  if (from === "resolved") return { ok: false, reason: "This request is finished." };
  return { ok: false, reason: "That is not the next step for this request." };
}

/** One line for a slab, a notification title or an email subject. */
export function summariseRequest(request: {
  readonly kind: RequestKind;
  readonly quantity: number | null;
  readonly roomName?: string | null;
}): string {
  const head = request.quantity === null
    ? describeRequestKind(request.kind)
    : `${describeRequestKind(request.kind)} × ${String(request.quantity)}`;
  const room = request.roomName ?? null;
  return room === null || room.length === 0 ? head : `${head} · ${room}`;
}

// --- The row ---------------------------------------------------------------

const IsoInstant = z.string().datetime({ offset: true });

export const VenueRequestSchema = z.object({
  id: RequestIdSchema,
  venueId: VenueIdSchema,
  /** The booking whose slot this request belongs to; null for a request made
   *  about a room with nothing booked in it. */
  bookingId: UUID.nullable(),
  eventId: UUID.nullable(),
  roomId: UUID,
  roomName: z.string().min(1).max(200).nullable(),
  kind: RequestKindSchema,
  quantity: z.number().int().positive().max(999).nullable(),
  urgency: RequestUrgencySchema,
  detail: z.string().max(500).nullable(),
  requestedByUserId: UUID.nullable(),
  requestedByName: z.string().min(1).max(160),
  requestedByRole: z.string().min(1).max(30),
  /** Fixed at creation, never widened. */
  audienceRoles: z.array(UserRoleSchema).min(1),
  ownerUserId: UUID.nullable(),
  ownerName: z.string().min(1).max(160).nullable(),
  state: RequestStateSchema,
  outcome: RequestOutcomeSchema.nullable(),
  outcomeNote: z.string().max(500).nullable(),
  /** When an unanswered "now" request reaches the venue administrator. Null
   *  when the venue has not set an escalation window. */
  escalationDueAt: IsoInstant.nullable(),
  escalatedAt: IsoInstant.nullable(),
  acknowledgedAt: IsoInstant.nullable(),
  acceptedAt: IsoInstant.nullable(),
  resolvedAt: IsoInstant.nullable(),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
});
export type VenueRequest = z.infer<typeof VenueRequestSchema>;

export const RequestStatusHistoryEntrySchema = z.object({
  id: UUID,
  requestId: RequestIdSchema,
  fromState: RequestStateSchema.nullable(),
  toState: RequestStateSchema,
  actorUserId: UUID.nullable(),
  actorName: z.string().min(1).max(160),
  actorRole: z.string().min(1).max(30),
  outcome: RequestOutcomeSchema.nullable(),
  note: z.string().max(500).nullable(),
  at: IsoInstant,
});
export type RequestStatusHistoryEntry = z.infer<typeof RequestStatusHistoryEntrySchema>;

// --- What a client may send ------------------------------------------------

const Detail = z.string().trim().min(1).max(500);

export const CreateVenueRequestSchema = z.object({
  bookingId: UUID.nullish(),
  eventId: UUID.nullish(),
  roomId: UUID,
  kind: RequestKindSchema,
  quantity: z.number().int().positive().max(999).nullish(),
  urgency: RequestUrgencySchema,
  detail: Detail.nullish(),
  /** Client-minted, so the same press replayed over a flaky phone signal
   *  returns the request that already exists instead of making a second. */
  idempotencyKey: UUID,
}).strict();
export type CreateVenueRequest = z.infer<typeof CreateVenueRequestSchema>;

/** Strict on purpose: a body carrying `audienceRoles` is a 400, not a silent
 *  no-op — the audience is decided once and the caller should hear that. */
export const RequestTransitionSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("acknowledged") }).strict(),
  z.object({ to: z.literal("accepted") }).strict(),
  z.object({
    to: z.literal("resolved"),
    outcome: RequestOutcomeSchema,
    note: Detail.nullish(),
  }).strict(),
]);
export type RequestTransition = z.infer<typeof RequestTransitionSchema>;

export const RequestListQuerySchema = z.object({
  bookingId: UUID.optional(),
  roomId: UUID.optional(),
  /** "open" is the board's question: everything not yet finished. */
  status: z.enum(["open", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type RequestListQuery = z.infer<typeof RequestListQuerySchema>;

/** A request is open until it is finished — the slab shows exactly these. */
export function isOpenRequest(request: { readonly state: RequestState }): boolean {
  return request.state !== "resolved";
}
