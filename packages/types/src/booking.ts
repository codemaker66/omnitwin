import { z } from "zod";

// ---------------------------------------------------------------------------
// Booking domain — Diary Slice 1 (Canon §1–§4; architecture doc §1–§5).
//
// The Diary's commitment axis. A booking is space-time commitment truth:
// prospect (never blocks), hold (ranked option-ladder pencil), ink (definite;
// the only kind the DB exclusion constraint arbitrates), internal_block
// (venue-generated unavailability). Two columns carry the lifecycle:
//
//   kind    — what the commitment IS; mutates only on promotion
//             (prospect→hold, prospect→ink, hold→ink)
//   status  — liveness; `active` until exactly one terminal exit
//             (released / expired / cancelled / lost)
//
// The Canon's flat "state" vocabulary is DERIVED: an active row's state is
// its kind, an exited row's state is its exit status. The split preserves
// wash-rate provenance (a released hold remains knowably a hold — Canon §3
// calibrates demand forecasting on exactly that denominator) while keeping
// the ink exclusion predicate crisp (kind='ink' AND status='active').
//
// Times are ISO-8601 instants (UTC storage; venue-local evaluation happens in
// consumers against venues.timezone). This module is planning support only —
// nothing here encodes legal, licensing, fire, or occupancy determinations.
// ---------------------------------------------------------------------------

export const BookingIdSchema = z.string().uuid();
export type BookingId = z.infer<typeof BookingIdSchema>;

export const TurnaroundRuleIdSchema = z.string().uuid();
export type TurnaroundRuleId = z.infer<typeof TurnaroundRuleIdSchema>;

const IsoInstantSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const BOOKING_KINDS = ["prospect", "hold", "ink", "internal_block"] as const;
export const BookingKindSchema = z.enum(BOOKING_KINDS);
export type BookingKind = z.infer<typeof BookingKindSchema>;

export const BOOKING_EXIT_STATES = ["released", "expired", "cancelled", "lost"] as const;
export type BookingExitState = (typeof BOOKING_EXIT_STATES)[number];

export const BOOKING_LIVENESS_STATUSES = ["active", ...BOOKING_EXIT_STATES] as const;
export const BookingLivenessSchema = z.enum(BOOKING_LIVENESS_STATUSES);
export type BookingLiveness = z.infer<typeof BookingLivenessSchema>;

/** The Canon's flat lifecycle vocabulary: kinds while active, exits after. */
export const BOOKING_STATES = [...BOOKING_KINDS, ...BOOKING_EXIT_STATES] as const;
export const BookingStateSchema = z.enum(BOOKING_STATES);
export type BookingState = z.infer<typeof BookingStateSchema>;

const BOOKING_KIND_SET: ReadonlySet<string> = new Set(BOOKING_KINDS);

function isBookingKind(value: BookingState): value is BookingKind {
  return BOOKING_KIND_SET.has(value);
}

/** Derive the Canon §1 state from the stored kind/status pair. */
export function deriveBookingState(kind: BookingKind, status: BookingLiveness): BookingState {
  return status === "active" ? kind : status;
}

/**
 * Resolve a target state to the column pair a transition must write.
 * Promotions become an active row of the target kind; exits keep the current
 * kind (provenance) and set the terminal status.
 */
export function bookingStateToColumns(
  toState: BookingState,
  currentKind: BookingKind,
): { readonly kind: BookingKind; readonly status: BookingLiveness } {
  if (isBookingKind(toState)) {
    return { kind: toState, status: "active" };
  }
  return { kind: currentKind, status: toState };
}

// ---------------------------------------------------------------------------
// Structural transition matrix (Canon §1/§3). Role policy lives in
// api/src/state-machines/booking.ts — this matrix answers only "does the
// lifecycle permit this move at all".
// ---------------------------------------------------------------------------

export const VALID_BOOKING_TRANSITIONS: Readonly<
  Record<BookingState, readonly BookingState[]>
> = {
  prospect: ["hold", "ink", "lost"],
  hold: ["ink", "released", "expired", "lost"],
  ink: ["cancelled"],
  internal_block: ["released"],
  released: [],
  expired: [],
  cancelled: [],
  lost: [],
};

/** Returns true if transitioning from `from` to `to` is a legal state change. */
export function isValidBookingTransition(from: BookingState, to: BookingState): boolean {
  return VALID_BOOKING_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Serialized booking (API output). `state` is derived server-side so every
// consumer reads the Canon vocabulary without recomputing the split.
// ---------------------------------------------------------------------------

export const BookingSchema = z.object({
  id: BookingIdSchema,
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  eventId: z.string().uuid().nullable(),
  kind: BookingKindSchema,
  status: BookingLivenessSchema,
  state: BookingStateSchema,
  title: z.string().min(1).max(200),
  eventType: z.string().max(80).nullable(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  rank: z.number().int().min(1).nullable(),
  jointFlag: z.boolean(),
  decisionAt: IsoInstantSchema.nullable(),
  ownerUserId: z.string().uuid().nullable(),
  nextAction: z.string().max(500).nullable(),
  nextActionDueAt: IsoInstantSchema.nullable(),
  seriesId: z.string().uuid().nullable(),
  notes: z.string().max(2000).nullable(),
  createdBy: z.string().uuid().nullable(),
  /** Conversion provenance (T-496): the enquiry this booking was pencilled from. */
  enquiryId: z.string().uuid().nullable(),
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
});
export type Booking = z.infer<typeof BookingSchema>;

// ---------------------------------------------------------------------------
// Create / update / transition inputs.
//
// Hold hygiene (Canon §3, the wedge; §17 universal law): a hold cannot exist
// without a decision date, an owner, a next action, and the date that action
// is due. Enforced at creation — not reported after death.
// ---------------------------------------------------------------------------

function addRequiredHoldIssue(ctx: z.RefinementCtx, field: string): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [field],
    message: `A hold requires ${field} — pencils carry a decision date, an owner, and a dated next action (hold hygiene).`,
  });
}

const CreateBookingBaseSchema = z.object({
  venueId: z.string().uuid(),
  spaceId: z.string().uuid(),
  eventId: z.string().uuid().optional(),
  kind: BookingKindSchema,
  title: z.string().trim().min(1).max(200),
  eventType: z.string().trim().min(1).max(80).optional(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  rank: z.number().int().min(1).optional(),
  jointFlag: z.boolean().optional(),
  decisionAt: IsoInstantSchema.optional(),
  ownerUserId: z.string().uuid().optional(),
  nextAction: z.string().max(500).optional(),
  nextActionDueAt: IsoInstantSchema.optional(),
  seriesId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export const CreateBookingSchema = CreateBookingBaseSchema.superRefine((value, ctx) => {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "endsAt must be after startsAt — a booking occupies a real interval.",
    });
  }
  if (value.kind === "hold") {
    if (value.decisionAt === undefined) addRequiredHoldIssue(ctx, "decisionAt");
    if (value.ownerUserId === undefined) addRequiredHoldIssue(ctx, "ownerUserId");
    if (value.nextAction === undefined || value.nextAction.trim().length === 0) {
      addRequiredHoldIssue(ctx, "nextAction");
    }
    if (value.nextActionDueAt === undefined) addRequiredHoldIssue(ctx, "nextActionDueAt");
  } else if (value.rank !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rank"],
      message: "Only holds carry an option-ladder rank.",
    });
  }
});
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>;

/**
 * Edit surface. Strict: kind/status never move through PATCH (transitions own
 * the lifecycle), and hygiene fields cannot be nulled off a live hold — they
 * may only be replaced with new values.
 */
export const UpdateBookingSchema = z
  .object({
    // Cross-lane move (the Board): a booking may change room, never lose one.
    spaceId: z.string().uuid().optional(),
    eventId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    eventType: z.string().trim().min(1).max(80).nullable().optional(),
    startsAt: IsoInstantSchema.optional(),
    endsAt: IsoInstantSchema.optional(),
    rank: z.number().int().min(1).optional(),
    jointFlag: z.boolean().optional(),
    decisionAt: IsoInstantSchema.optional(),
    ownerUserId: z.string().uuid().optional(),
    nextAction: z.string().trim().min(1).max(500).optional(),
    nextActionDueAt: IsoInstantSchema.optional(),
    seriesId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.startsAt !== undefined &&
      value.endsAt !== undefined &&
      Date.parse(value.endsAt) <= Date.parse(value.startsAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "endsAt must be after startsAt — a booking occupies a real interval.",
      });
    }
  });
export type UpdateBookingInput = z.infer<typeof UpdateBookingSchema>;

export const TransitionBookingSchema = z.object({
  toState: BookingStateSchema,
  note: z.string().max(2000).optional(),
});
export type TransitionBookingInput = z.infer<typeof TransitionBookingSchema>;

/**
 * Enquiry→hold conversion (T-496; Canon §12 P0). Always creates a HOLD, so
 * the hygiene quartet is required at the schema level — no pencil without a
 * decision date, an owner, and a dated next action. spaceId/title/eventType
 * default from the enquiry server-side when omitted.
 */
export const ConvertEnquirySchema = z
  .object({
    enquiryId: z.string().uuid(),
    spaceId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    eventType: z.string().trim().min(1).max(80).optional(),
    startsAt: IsoInstantSchema,
    endsAt: IsoInstantSchema,
    rank: z.number().int().min(1).optional(),
    jointFlag: z.boolean().optional(),
    decisionAt: IsoInstantSchema,
    ownerUserId: z.string().uuid(),
    nextAction: z.string().trim().min(1).max(500),
    nextActionDueAt: IsoInstantSchema,
    notes: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "endsAt must be after startsAt — a booking occupies a real interval.",
      });
    }
  });
export type ConvertEnquiryInput = z.infer<typeof ConvertEnquirySchema>;

// ---------------------------------------------------------------------------
// Turnaround rules — minimal v0 (per space + event type, minutes), shaped
// like pricing_rules. Null spaceId = venue-wide; null eventType = all types.
// ---------------------------------------------------------------------------

export const TurnaroundRuleSchema = z.object({
  id: TurnaroundRuleIdSchema,
  venueId: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  eventType: z.string().max(80).nullable(),
  name: z.string().min(1).max(200),
  minutes: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
});
export type TurnaroundRule = z.infer<typeof TurnaroundRuleSchema>;

// ---------------------------------------------------------------------------
// Conflict engine v0 output (Canon §4). Severity is graded, explanations are
// plain English, and unchecked things say `not_checked` — never OK.
// ---------------------------------------------------------------------------

export const CONFLICT_SEVERITIES = ["blocking", "warning", "info"] as const;
export const ConflictSeveritySchema = z.enum(CONFLICT_SEVERITIES);
export type ConflictSeverity = z.infer<typeof ConflictSeveritySchema>;

export const CALENDAR_CONFLICT_TYPES = [
  "ink_double_book",
  "hold_overlap",
  "insufficient_turnaround",
] as const;
export const CalendarConflictTypeSchema = z.enum(CALENDAR_CONFLICT_TYPES);
export type CalendarConflictType = z.infer<typeof CalendarConflictTypeSchema>;

export const CalendarConflictSchema = z.object({
  id: z.string().min(1),
  type: CalendarConflictTypeSchema,
  severity: ConflictSeveritySchema,
  spaceId: z.string().uuid(),
  entryIds: z.tuple([z.string().min(1), z.string().min(1)]),
  explanation: z.string().min(1),
});
export type CalendarConflict = z.infer<typeof CalendarConflictSchema>;

export const CheckedStatusSchema = z.object({ status: z.literal("checked") });

export const TurnaroundCheckStatusSchema = z.object({
  status: z.enum(["checked", "partial", "not_checked"]),
  uncoveredPairCount: z.number().int().nonnegative(),
  detail: z.string(),
});

export const ConflictReportSchema = z.object({
  conflicts: z.array(CalendarConflictSchema),
  checks: z.object({
    inkDoubleBook: CheckedStatusSchema,
    holdOverlap: CheckedStatusSchema,
    turnaround: TurnaroundCheckStatusSchema,
  }),
});
export type ConflictReport = z.infer<typeof ConflictReportSchema>;

// ---------------------------------------------------------------------------
// GET /calendar read model (Canon §12 P0) — one endpoint every view shares.
// ---------------------------------------------------------------------------

export const MAX_CALENDAR_RANGE_DAYS = 366;
const MAX_CALENDAR_RANGE_MS = MAX_CALENDAR_RANGE_DAYS * 24 * 60 * 60 * 1000;

export const CalendarQuerySchema = z
  .object({
    venueId: z.string().uuid(),
    from: IsoInstantSchema,
    to: IsoInstantSchema,
    spaceIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const fromMs = Date.parse(value.from);
    const toMs = Date.parse(value.to);
    if (toMs <= fromMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "to must be after from.",
      });
      return;
    }
    if (toMs - fromMs > MAX_CALENDAR_RANGE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Calendar range must not exceed ${String(MAX_CALENDAR_RANGE_DAYS)} days.`,
      });
    }
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export const CalendarRoomSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  sortOrder: z.number().int(),
});
export type CalendarRoom = z.infer<typeof CalendarRoomSchema>;

export const CalendarBookingEntrySchema = z.object({
  entryType: z.literal("booking"),
  id: BookingIdSchema,
  spaceId: z.string().uuid(),
  kind: BookingKindSchema,
  status: BookingLivenessSchema,
  state: BookingStateSchema,
  title: z.string().min(1).max(200),
  eventType: z.string().max(80).nullable(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  rank: z.number().int().min(1).nullable(),
  jointFlag: z.boolean(),
  decisionAt: IsoInstantSchema.nullable(),
  ownerUserId: z.string().uuid().nullable(),
  nextAction: z.string().max(500).nullable(),
  nextActionDueAt: IsoInstantSchema.nullable(),
  eventId: z.string().uuid().nullable(),
  seriesId: z.string().uuid().nullable(),
});
export type CalendarBookingEntry = z.infer<typeof CalendarBookingEntrySchema>;

/** Room-scoped, timed phases only — the Occupancy Footprint on a lane. */
export const CalendarPhaseEntrySchema = z.object({
  entryType: z.literal("phase"),
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  eventId: z.string().uuid(),
  eventName: z.string().min(1),
  name: z.string().min(1),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  sortOrder: z.number().int(),
});
export type CalendarPhaseEntry = z.infer<typeof CalendarPhaseEntrySchema>;

export const CalendarEntrySchema = z.discriminatedUnion("entryType", [
  CalendarBookingEntrySchema,
  CalendarPhaseEntrySchema,
]);
export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;

export const CalendarResponseSchema = z.object({
  venueId: z.string().uuid(),
  range: z.object({ from: IsoInstantSchema, to: IsoInstantSchema }),
  rooms: z.array(CalendarRoomSchema),
  entries: z.array(CalendarEntrySchema),
  conflicts: ConflictReportSchema,
});
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;
