import { z } from "zod";

// ---------------------------------------------------------------------------
// Layout live co-editing (v1) — the wire protocol of the presence and live-op
// channel carried by /ws/configurations/:configId after its auth frame.
//
// Two channels, one law between them (live co-editing design, 22 Aug 2026):
//   - EPHEMERAL: presence, the room each person is viewing, and live ops (the
//     absolute state of an object someone just placed, moved or deleted).
//     Relayed in memory, stamped with a per-room sequence by the server, never
//     written anywhere. A live op is a prediction, not the layout.
//   - DURABLE: the existing batch save and its configurations.revision
//     compare-and-swap. After a commit the server announces
//     `layout.changed { revision }`; clients refetch and adopt. Only that
//     path ever changes what the layout IS.
//
// Positions are REAL METRES — the same frame as the batch save and the
// database — never the planner's render space. Older clients ignore unknown
// frame types; newer servers may add fields.
// ---------------------------------------------------------------------------

/** A persisted object id (uuid) or an unsaved placement's local id. */
export const LiveObjectIdSchema = z.string().regex(
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|local-[A-Za-z0-9-]{1,64})$/i,
  "Expected a placed-object uuid or a local-… id",
);

const Finite = z.number().finite();

/** Placed-object metadata as the planner writes it: flat, primitive values
 *  only (cloth, table setting, dressing, group, label, note). Nested values
 *  are refused — a deeply nested blob validates as "unknown" but breaks
 *  JSON.stringify on the relay, which would take the API process down. */
const LiveMetadataSchema = z
  .record(z.string(), z.union([z.string().max(2_000), Finite, z.boolean(), z.null()]))
  .refine((value) => Object.keys(value).length <= 32, "Too many metadata keys");

/** One object's complete state, in the batch save's field names and units. */
export const LiveObjectStateSchema = z.object({
  id: LiveObjectIdSchema,
  assetDefinitionId: z.string().min(1).max(120),
  positionX: Finite,
  positionY: Finite,
  positionZ: Finite,
  rotationX: Finite,
  rotationY: Finite,
  rotationZ: Finite,
  scale: Finite.positive(),
  sortOrder: z.number().int().nonnegative(),
  metadata: LiveMetadataSchema.nullable(),
});
export type LiveObjectState = z.infer<typeof LiveObjectStateSchema>;

export const LiveOpSchema = z.discriminatedUnion("kind", [
  /** Placed or moved: the object's whole state after the change. */
  z.object({ kind: z.literal("put"), object: LiveObjectStateSchema }),
  z.object({ kind: z.literal("remove"), id: LiveObjectIdSchema }),
]);
export type LiveOp = z.infer<typeof LiveOpSchema>;

/** A multi-select drag of a full banquet stays under this. */
export const LIVE_MAX_OPS_PER_FRAME = 300;

/** What a participant reports they are looking at. Display only. */
export const LiveViewSchema = z.object({
  spaceId: z.string().uuid().nullable(),
  /** The room's name as the viewer's planner shows it ("Grand Hall"). */
  label: z.string().trim().min(1).max(80),
});
export type LiveView = z.infer<typeof LiveViewSchema>;

const IdPairs = z.array(z.tuple([LiveObjectIdSchema, z.string().uuid()])).max(500);

// --- client → server -------------------------------------------------------

export const LiveClientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("live.view"), view: LiveViewSchema }),
  z.object({
    type: z.literal("live.ops"),
    ops: z.array(LiveOpSchema).min(1).max(LIVE_MAX_OPS_PER_FRAME),
  }),
  /** After a save commits: the ids the server gave this client's local
   *  placements, so peers can retire the matching live placements. */
  z.object({
    type: z.literal("live.saved"),
    revision: z.number().int().min(1),
    ids: IdPairs,
  }),
]);
export type LiveClientFrame = z.infer<typeof LiveClientFrameSchema>;

/** Every client frame the live channel owns starts with this prefix. */
export function isLiveClientFrameType(type: unknown): boolean {
  return typeof type === "string" && type.startsWith("live.");
}

// --- server → client -------------------------------------------------------

export const LiveParticipantSchema = z.object({
  /** Presence is per CONNECTION: two tabs are two cursors, not one person. */
  connectionId: z.string().min(1).max(64),
  userId: z.string().min(1),
  /** Server-stamped from the authenticated user, never client-reported. */
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(40),
  view: LiveViewSchema.nullable(),
  joinedAtMs: z.number().int().nonnegative(),
});
export type LiveParticipant = z.infer<typeof LiveParticipantSchema>;

const ServerClock = z.number().int().positive();

export const LiveServerFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("live.hello"),
    connectionId: z.string().min(1).max(64),
    participants: z.array(LiveParticipantSchema),
    /** The room's op sequence high-water mark at join time. */
    seq: z.number().int().nonnegative(),
    serverNowMs: ServerClock,
  }),
  z.object({
    type: z.literal("live.presence"),
    participants: z.array(LiveParticipantSchema),
    serverNowMs: ServerClock,
  }),
  z.object({
    type: z.literal("live.ops"),
    /** Per-room total order. The sender receives its own frame back with its
     *  seq; the highest seq on an object is the last write. */
    seq: z.number().int().positive(),
    connectionId: z.string().min(1).max(64),
    userId: z.string().min(1),
    name: z.string().min(1).max(120),
    ops: z.array(LiveOpSchema).min(1).max(LIVE_MAX_OPS_PER_FRAME),
    serverNowMs: ServerClock,
  }),
  z.object({
    type: z.literal("live.saved"),
    seq: z.number().int().positive(),
    connectionId: z.string().min(1).max(64),
    revision: z.number().int().min(1),
    ids: IdPairs,
    serverNowMs: ServerClock,
  }),
  /** This connection may no longer be in the room (its role, venue or the
   *  layout changed since it joined). Stop showing and sending live state. */
  z.object({ type: z.literal("live.revoked"), serverNowMs: ServerClock }),
  /** A durable commit happened. Carries no geometry: refetch and adopt. */
  z.object({
    type: z.literal("layout.changed"),
    revision: z.number().int().min(1),
    actorUserId: z.string().nullable(),
    serverNowMs: ServerClock,
  }),
]);
export type LiveServerFrame = z.infer<typeof LiveServerFrameSchema>;

/** Parse one server frame; anything unknown or malformed is null and ignored. */
export function parseLiveServerFrame(raw: unknown): LiveServerFrame | null {
  const parsed = LiveServerFrameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// --- access -----------------------------------------------------------------

/** Customer roles: the current name and the legacy one. */
const LIVE_CUSTOMER_ROLES: ReadonlySet<string> = new Set(["client", "planner"]);
/** The venue floor, matching canManageVenue in the API. */
const LIVE_VENUE_FLOOR_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff", "hallkeeper"]);
/** Who may join as the layout's OWNER: the venue's own team. An allowlist, so a
 *  role added later (or a caterer) is refused until someone decides otherwise. */
const LIVE_OWNER_ROLES: ReadonlySet<string> = new Set([...LIVE_VENUE_FLOOR_ROLES, "sales"]);

export interface LiveAccessActor {
  readonly userId: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: string;
}

export interface LiveAccessLayout {
  readonly ownerUserId: string | null;
  readonly venueId: string;
}

/**
 * Who may join a layout's live room. v1: the layout's owner and the venue's
 * floor team, never a customer (client, or the legacy planner role) — clients
 * see nothing new. A Venviewer platform admin may join any room.
 */
export function canJoinLayoutLive(actor: LiveAccessActor, layout: LiveAccessLayout): boolean {
  if (actor.platformRole === "admin") return true;
  if (LIVE_CUSTOMER_ROLES.has(actor.role)) return false;
  if (LIVE_VENUE_FLOOR_ROLES.has(actor.role) && actor.venueId === layout.venueId) return true;
  return LIVE_OWNER_ROLES.has(actor.role) && layout.ownerUserId !== null && layout.ownerUserId === actor.userId;
}
