import { z } from "zod";
import { CalendarConflictTypeSchema, ConflictSeveritySchema } from "./booking.js";

// ---------------------------------------------------------------------------
// The decision object (goal 09 M1; goal 12 "one reusable change-impact and
// decision path"). A consequential change arrives at the venue as a prepared
// decision: what it is for, the options with a recommendation and its reasons,
// each option's consequences and the exact mutations it would make, what is
// not known, and who may approve it. It is executed only on approval, through
// the same domain command the Diary uses, after the venue's current state is
// checked again; a stale approval never executes, it returns the revised
// decision instead. Every step is kept in the decision's history.
//
// AI proposes, deterministic checks evaluate, people authorise (goal 09). A
// decision is prepared by deterministic code from the venue's own records; a
// language model never prepares, approves or executes one.
//
// The first decision wired is a booking time move (M2). The other classes
// are named so their approval authority is fixed now; each gains its
// preparation and execution in its own slice.
// ---------------------------------------------------------------------------

export const DECISION_SCHEMA_VERSION = "decision.v1";

export const DECISION_ACTION_CLASSES = ["booking_time_move", "guest_count_change", "stock_shortage", "service_request"] as const;
export const DecisionActionClassSchema = z.enum(DECISION_ACTION_CLASSES);
export type DecisionActionClass = z.infer<typeof DecisionActionClassSchema>;

/** The classes a decision can be prepared and executed for today. */
export const PREPARABLE_DECISION_CLASSES: readonly DecisionActionClass[] = ["booking_time_move"];

/**
 * Who approves each class of decision at their own venue: the narrow
 * approval capability, never canManageVenue (goal 09; docs/operations/
 * people-matrix.md §4). A time is approved by the venue's staff and admin
 * (Blake, 10 October 2026: "staff and admin only"); a quantity beyond the
 * released layout, a stock shortage and an unanswered request by its admin,
 * with the manager only if Blake says so. One class's approval never implies
 * another's. A platform admin is not a member of the venue and approves none.
 */
export const DECISION_APPROVER_ROLES: Readonly<Record<DecisionActionClass, readonly string[]>> = {
  booking_time_move: ["staff", "admin"],
  guest_count_change: ["admin"],
  stock_shortage: ["admin"],
  service_request: ["admin"],
};

/** Whether this person may approve this class of decision at this venue. */
export function canApproveDecision(
  person: { readonly role: string; readonly venueId: string | null },
  venueId: string,
  actionClass: DecisionActionClass,
): boolean {
  return person.venueId === venueId && DECISION_APPROVER_ROLES[actionClass].includes(person.role);
}

/**
 * Where a decision stands. `prepared` waits for a person. `executed` and
 * `declined` are decided (the kept option is a decline). `failed` was
 * approved but the venue's own rules refused the change when it was made
 * (another booking took the slot meanwhile, say): nothing changed. `superseded`
 * was found stale when approved and replaced by a revised decision.
 * `withdrawn` was taken back before anyone decided it.
 */
export const DECISION_STATUSES = ["prepared", "executed", "declined", "failed", "superseded", "withdrawn"] as const;
export const DecisionStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DECISION_URGENCIES = ["now", "soon", "routine"] as const;
export const DecisionUrgencySchema = z.enum(DECISION_URGENCIES);

const Instant = z.iso.datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Words = z.string().trim().min(1).max(500);

/** What one option would bring about that someone has to know: a clash the
 *  Diary's conflict engine finds that the booking does not have today, or a
 *  check it could not make. */
export const DecisionConsequenceSchema = z.object({
  kind: z.union([CalendarConflictTypeSchema, z.literal("not_checked")]),
  severity: ConflictSeveritySchema,
  summary: Words,
  /** The other bookings or phases it concerns. */
  concerns: z.array(z.string().min(1).max(80)).max(20),
}).strict();
export type DecisionConsequence = z.infer<typeof DecisionConsequenceSchema>;

/** The exact change an option makes, as the Diary's own command: a booking's
 *  times, by the command id the Diary's ledger records it under. */
export const DecisionMutationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("booking.update"),
    commandId: z.uuid(),
    bookingId: z.uuid(),
    startsAt: Instant,
    endsAt: Instant,
  }).strict(),
]);
export type DecisionMutation = z.infer<typeof DecisionMutationSchema>;

export const DecisionOptionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
  label: Words,
  /** False where the venue's own rules would refuse it as things stand (a
   *  confirmed booking already in the slot): shown, explained, not offered. */
  executable: z.boolean(),
  recommended: z.boolean(),
  reasons: z.array(Words).min(1).max(10),
  consequences: z.array(DecisionConsequenceSchema).max(30),
  mutations: z.array(DecisionMutationSchema).max(10),
}).strict();
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/** What the decision was prepared on, as the venue held it then. */
export const DecisionBasisSchema = z.object({
  /** The booking's whole state, as the Diary's update precondition reads it. */
  subjectDigest: Digest,
  /** The options' consequences as worked out then: neighbours that moved since change them. */
  consequenceDigest: Digest,
  title: Words,
  spaceId: z.uuid(),
  startsAt: Instant,
  endsAt: Instant,
}).strict();

export const DecisionReceiptSchema = z.object({
  optionId: z.string().min(1).max(40),
  decidedBy: z.uuid(),
  decidedAt: Instant,
  outcome: z.enum(["executed", "declined", "failed"]),
  /** The Diary command the change ran as, when one ran. */
  commandIds: z.array(z.uuid()).max(10),
  /** Why the venue's rules refused it, for a failed one. */
  refusal: z.object({ code: z.string().min(1).max(80), message: Words }).strict().nullable(),
}).strict();
export type DecisionReceipt = z.infer<typeof DecisionReceiptSchema>;

export const DecisionSchema = z.object({
  schemaVersion: z.literal(DECISION_SCHEMA_VERSION),
  id: z.uuid(),
  venueId: z.uuid(),
  actionClass: DecisionActionClassSchema,
  status: DecisionStatusSchema,
  subject: z.object({ kind: z.literal("booking"), id: z.uuid() }).strict(),
  intendedOutcome: Words,
  /** What was asked for, as asked: a revised decision is prepared from it. */
  requested: z.object({ startsAt: Instant, endsAt: Instant, reason: Words.nullable() }).strict(),
  basis: DecisionBasisSchema,
  options: z.array(DecisionOptionSchema).min(1).max(6),
  recommendedOptionId: z.string().min(1).max(40).nullable(),
  /** What is not known or not worked out, said rather than assumed. */
  missingFacts: z.array(Words).max(10),
  assumptions: z.array(Words).max(10),
  /** The smallest useful question for the approver, when one would settle it. */
  question: Words.nullable(),
  urgency: DecisionUrgencySchema,
  approverRoles: z.array(z.string().min(1).max(40)).min(1).max(10),
  preparedBy: z.uuid(),
  preparedAt: Instant,
  expiresAt: Instant,
  supersedes: z.uuid().nullable(),
  supersededBy: z.uuid().nullable(),
  receipt: DecisionReceiptSchema.nullable(),
}).strict();
export type Decision = z.infer<typeof DecisionSchema>;

/** What a decision was prepared as: kept whole, never changed after. */
export const DecisionBodySchema = DecisionSchema.pick({
  intendedOutcome: true,
  requested: true,
  basis: true,
  options: true,
  recommendedOptionId: true,
  missingFacts: true,
  assumptions: true,
  question: true,
  urgency: true,
  approverRoles: true,
});
export type DecisionBody = z.infer<typeof DecisionBodySchema>;

export const DECISION_EVENT_KINDS = ["prepared", "executed", "declined", "failed", "stale", "withdrawn", "execution_error"] as const;
export const DecisionEventKindSchema = z.enum(DECISION_EVENT_KINDS);
export type DecisionEventKind = z.infer<typeof DecisionEventKindSchema>;

/** One step in a decision's history, append-only. */
export const DecisionEventSchema = z.object({
  id: z.uuid(),
  decisionId: z.uuid(),
  kind: DecisionEventKindSchema,
  actorUserId: z.uuid(),
  at: Instant,
  /** The step's particulars: the option chosen, a refusal, the revised decision's id. */
  detail: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
}).strict();
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

export const DecisionWithHistorySchema = z.object({
  decision: DecisionSchema,
  history: z.array(DecisionEventSchema),
}).strict();
export type DecisionWithHistory = z.infer<typeof DecisionWithHistorySchema>;

/** Asking for a booking to move: the decision is prepared from what the Diary holds. */
export const PrepareBookingTimeMoveSchema = z.object({
  bookingId: z.uuid(),
  startsAt: Instant,
  endsAt: Instant,
  /** Why, in the asker's words: shown with the decision. */
  reason: Words.optional(),
}).strict().refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
  message: "endsAt must be after startsAt",
  path: ["endsAt"],
});
export type PrepareBookingTimeMove = z.infer<typeof PrepareBookingTimeMoveSchema>;

/** Deciding: the option chosen, and the basis the approver was shown, so a
 *  decision read before it changed is never decided by mistake. */
export const DecideDecisionSchema = z.object({
  optionId: z.string().min(1).max(40),
  subjectDigest: Digest,
}).strict();
export type DecideDecision = z.infer<typeof DecideDecisionSchema>;

export const DECISION_STALE = "DECISION_STALE";
export const DECISION_CLOSED = "DECISION_CLOSED";
