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
 * The kinds that make a room unavailable to anyone else while they are active
 * and not deleted — what "busy" means on the public free/busy read (T-649).
 *
 * `ink` is the Diary's hard floor (Canon §2.2): the only kind the
 * `bookings_ink_no_overlap` exclusion constraint arbitrates and the only
 * pairing the conflict engine rates `blocking`. `internal_block` is the
 * venue's own unavailability (maintenance, blackouts). Provisional holds are
 * deliberately absent: they stack as 1st/2nd options by design, a later
 * enquirer can still take the next option, and the engine rates hold overlaps
 * advisory. Prospects never block.
 */
export const ROOM_BLOCKING_BOOKING_KINDS = ["ink", "internal_block"] as const satisfies readonly BookingKind[];

const ROOM_BLOCKING_KIND_SET: ReadonlySet<BookingKind> = new Set(ROOM_BLOCKING_BOOKING_KINDS);

/** Whether this booking makes its room unavailable (see ROOM_BLOCKING_BOOKING_KINDS). */
export function bookingBlocksRoom(booking: {
  readonly kind: BookingKind;
  readonly status: BookingLiveness;
  readonly deletedAt: Date | string | null;
}): boolean {
  return booking.deletedAt === null && booking.status === "active" && ROOM_BLOCKING_KIND_SET.has(booking.kind);
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

/** What a provisional hold must carry, in the words the drawer shows. */
const HOLD_REQUIREMENT_WORDS: Readonly<Record<string, string>> = {
  decisionAt: "a decision date",
  ownerUserId: "an owner",
  nextAction: "a next action",
  nextActionDueAt: "a date for its next action",
};

function addRequiredHoldIssue(ctx: z.RefinementCtx, field: string): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [field],
    message: `A provisional hold needs ${HOLD_REQUIREMENT_WORDS[field] ?? field}.`,
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
      message: "Only a provisional hold has an option number.",
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

/** What a booking needs to become a live provisional hold (roadmap N3): a
 *  live hold carries a decision date, an owner and a dated next action, and
 *  a place on its ladder. Each is optional here because the booking may
 *  already have it; the API refuses the transition when the hold would still
 *  lack any, and the owner defaults to whoever makes it provisional. */
export const TransitionHoldSchema = z.object({
  decisionAt: IsoInstantSchema.optional(),
  ownerUserId: z.string().uuid().optional(),
  nextAction: z.string().trim().min(1).max(500).optional(),
  nextActionDueAt: IsoInstantSchema.optional(),
  rank: z.number().int().min(1).optional(),
  jointFlag: z.boolean().optional(),
});
export type TransitionHoldInput = z.infer<typeof TransitionHoldSchema>;

export const TransitionBookingSchema = z.object({
  toState: BookingStateSchema,
  note: z.string().max(2000).optional(),
  hold: TransitionHoldSchema.optional(),
}).refine((input) => input.hold === undefined || input.toState === "hold", {
  message: "Only a booking made provisional takes a hold's details.",
  path: ["hold"],
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
// Turnaround rules as staff set them (T-637 slice A)
//
// Staff choose a room (or all rooms), an event type (or any) and the minutes;
// the rule's name is derived from that scope. A rule nobody has confirmed,
// such as a seeded demo value, has no confirmedAt and reads "Not confirmed".
// ---------------------------------------------------------------------------

/** The longest changeover one rule may hold: a day. */
export const TURNAROUND_MAX_MINUTES = 1440;

export const TurnaroundMinutesSchema = z.number().int().min(0).max(TURNAROUND_MAX_MINUTES);

export const TurnaroundRuleSettingSchema = TurnaroundRuleSchema.extend({
  /** When a person last saved the rule; null for one nobody has confirmed. */
  confirmedAt: IsoInstantSchema.nullable(),
  /** Who last saved it, when known. */
  updatedByName: z.string().nullable(),
});
export type TurnaroundRuleSetting = z.infer<typeof TurnaroundRuleSettingSchema>;

export const TurnaroundRulesResponseSchema = z.object({
  rules: z.array(TurnaroundRuleSettingSchema),
  /** The venue's rooms, in the venue's own order. */
  rooms: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  /** Event types the venue's bookings and events use, most used first. */
  eventTypes: z.array(z.string()),
});
export type TurnaroundRulesResponse = z.infer<typeof TurnaroundRulesResponseSchema>;

export const CreateTurnaroundRuleSchema = z.object({
  spaceId: z.string().uuid().nullable(),
  eventType: z.string().trim().min(1).max(80).nullable(),
  minutes: TurnaroundMinutesSchema,
});
export type CreateTurnaroundRule = z.infer<typeof CreateTurnaroundRuleSchema>;

export const UpdateTurnaroundRuleSchema = z.object({
  minutes: TurnaroundMinutesSchema,
  /** The rule's updatedAt as the editor last saw it: a newer change wins,
   *  and the editor is shown it rather than silently overwriting it. */
  expectedUpdatedAt: IsoInstantSchema,
});
export type UpdateTurnaroundRule = z.infer<typeof UpdateTurnaroundRuleSchema>;

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
  // --- Command Centre card face (C1) -------------------------------------
  // Optional so older servers and recorded fixtures stay valid (the
  // turnaroundRules contract); nullable because a booking may have no
  // event, or the event may be soft-deleted. guestCount is the event's
  // legacy working number — the headcount triple stays server-side until
  // a card needs it. notes is the booking's own margin note.
  eventName: z.string().max(200).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  guestCount: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // The owner as a person (T-619): the user's display name, else their name.
  // `ownerUserId` alone is a uuid nobody can act on. Optional for the same
  // reason as the fields above (older servers, recorded fixtures); null when
  // the booking has no owner or that user row is gone.
  ownerName: z.string().max(200).nullable().optional(),
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

/** The venue's turnaround guidance rules, as the calendar read model carries
 *  them: the same rows the server's conflict engine resolves (most-specific
 *  active rule for (spaceId, incoming eventType), ties toward the LARGEST
 *  minutes). Exposed so a client can draw guideline buffers for positions
 *  that do not exist yet (the When ribbon's hatched shoulders) — guidance
 *  for the team's own judgement, never an enforced gap. */
export const CalendarTurnaroundRuleSchema = z.object({
  spaceId: z.string().uuid().nullable(),
  eventType: z.string().max(80).nullable(),
  name: z.string().min(1).max(200),
  minutes: z.number().int().nonnegative(),
  isActive: z.boolean(),
});
export type CalendarTurnaroundRule = z.infer<typeof CalendarTurnaroundRuleSchema>;

/** How far ahead the Diary's venue-wide decisions list looks: the horizon of
 *  the first hold reminder (T-7), so a provisional hold joins the list on the
 *  day its owner's first reminder is due. */
export const DECISIONS_DUE_HORIZON_DAYS = 7;

/** The most provisional holds one calendar read carries on that list. */
export const DECISIONS_DUE_LIMIT = 50;

/** A hold that belongs on the decisions list: provisional, still active, and
 *  carrying the decision date the list is ordered by. */
const DecisionDueHoldSchema = CalendarBookingEntrySchema.refine(
  (entry) => entry.kind === "hold" && entry.status === "active" && entry.decisionAt !== null,
  { message: "Only an active hold with a decision date is a decision due." },
);

/** The venue-wide list of provisional holds whose decision date has passed or
 *  falls within DECISIONS_DUE_HORIZON_DAYS — whatever the booking's own date,
 *  so a hold six months out still appears on this week's board. */
export const CalendarDecisionsDueSchema = z.object({
  /** Most overdue first. Full calendar entries, so the Diary can open one
   *  without first moving the board to its week. */
  holds: z.array(DecisionDueHoldSchema).max(DECISIONS_DUE_LIMIT),
  /** Every such hold in the venue; larger than `holds.length` when capped. */
  total: z.number().int().nonnegative(),
}).refine((list) => list.total >= list.holds.length, {
  message: "total cannot be smaller than the holds listed.",
  path: ["total"],
});
export type CalendarDecisionsDue = z.infer<typeof CalendarDecisionsDueSchema>;

/** How far ahead the Diary's venue-wide Needs attention list looks for next
 *  actions: the same week as the decisions list (roadmap N3). */
export const NEXT_ACTIONS_DUE_HORIZON_DAYS = 7;

/** The most provisional holds one calendar read carries on that list. */
export const NEXT_ACTIONS_DUE_LIMIT = 50;

/** A hold that belongs on Needs attention: provisional, still active, and
 *  carrying the next action date the list is ordered by. */
const NextActionDueHoldSchema = CalendarBookingEntrySchema.refine(
  (entry) => entry.kind === "hold" && entry.status === "active" && entry.nextActionDueAt !== null,
  { message: "Only an active hold with a next action date needs attention." },
);

/** The venue-wide list of provisional holds whose next action is overdue or
 *  due within NEXT_ACTIONS_DUE_HORIZON_DAYS, whatever the booking's own date,
 *  so a hold six months out still appears on this week's board. */
export const CalendarNextActionsDueSchema = z.object({
  /** Most overdue first. Full calendar entries, so the Diary can open one
   *  without first moving the board to its week. */
  holds: z.array(NextActionDueHoldSchema).max(NEXT_ACTIONS_DUE_LIMIT),
  /** Every such hold in the venue; larger than `holds.length` when capped. */
  total: z.number().int().nonnegative(),
}).refine((list) => list.total >= list.holds.length, {
  message: "total cannot be smaller than the holds listed.",
  path: ["total"],
});
export type CalendarNextActionsDue = z.infer<typeof CalendarNextActionsDueSchema>;

/** How far ahead the Diary's venue-wide Contested dates list looks (roadmap
 *  N3): a year of the ladder. */
export const CONTESTED_HORIZON_DAYS = 365;

/** The most contested dates one calendar read carries, soonest first. */
export const CONTESTED_LIMIT = 20;

/** One room and time that more than one live booking wants (roadmap N3):
 *  provisional holds crossing each other, or a hold crossing a confirmed
 *  booking, as the conflict engine's hold overlap counts them. Bookings that
 *  cross in a chain (A with B, B with C) are one contested time. */
export const CalendarContestedDateSchema = z.object({
  spaceId: z.string().uuid(),
  /** The earliest start and latest end of the bookings in contest. */
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  /** Confirmed bookings first, then the holds in ladder order (unranked
   *  last); full calendar entries, so each opens where it stands. */
  bookings: z.array(CalendarBookingEntrySchema).min(2),
}).refine((date) => date.bookings.some((entry) => entry.kind === "hold"), {
  message: "A contested date has at least one provisional hold.",
  path: ["bookings"],
});
export type CalendarContestedDate = z.infer<typeof CalendarContestedDateSchema>;

/** The venue's contested dates from now to CONTESTED_HORIZON_DAYS ahead. */
export const CalendarContestedSchema = z.object({
  dates: z.array(CalendarContestedDateSchema).max(CONTESTED_LIMIT),
  /** Every contested date in the horizon; larger than `dates.length` when
   *  capped. */
  total: z.number().int().nonnegative(),
}).refine((list) => list.total >= list.dates.length, {
  message: "total cannot be smaller than the dates listed.",
  path: ["total"],
});
export type CalendarContested = z.infer<typeof CalendarContestedSchema>;

export const CalendarResponseSchema = z.object({
  venueId: z.string().uuid(),
  range: z.object({ from: IsoInstantSchema, to: IsoInstantSchema }),
  rooms: z.array(CalendarRoomSchema),
  entries: z.array(CalendarEntrySchema),
  conflicts: ConflictReportSchema,
  /** Optional so older servers (and recorded fixtures) stay valid; a client
   *  that needs buffer geometry treats absence as "guidelines unavailable". */
  turnaroundRules: z.array(CalendarTurnaroundRuleSchema).optional(),
  /** Optional so older servers stay valid; a client treats absence as "the
   *  venue-wide list is unavailable", never as "nothing is due". */
  decisionsDue: CalendarDecisionsDueSchema.optional(),
  /** Optional so older servers stay valid; a client treats absence as "the
   *  venue-wide list is unavailable", never as "nothing needs attention". */
  nextActionsDue: CalendarNextActionsDueSchema.optional(),
  /** Optional so older servers stay valid; a client treats absence as "the
   *  venue-wide list is unavailable", never as "nothing is contested". */
  contested: CalendarContestedSchema.optional(),
});
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;
