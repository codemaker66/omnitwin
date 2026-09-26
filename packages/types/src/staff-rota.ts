import { z } from "zod";

// ---------------------------------------------------------------------------
// The staff rota, version 1 (T-637 slice B)
//
// Who is on, when, and in what role. People need no login to be rostered; a
// shift can be an unfilled need; a week is planned in draft and published,
// which tells the people on it. Working-time warnings sit beside each shift in
// plain words (staff-rota-checks.ts). The only hard blocks are the two legal
// ones: an under-18 between midnight and 04:00, and publishing a shift for
// someone whose right to work has not been checked.
//
// Planning support, not legal advice: the rules and their sources are in
// docs/design/platform-2026-09-26/research/rota.md.
// ---------------------------------------------------------------------------

const IsoInstantSchema = z.string().datetime({ offset: true });
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use a date such as 2026-10-05")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, "Not a real date");

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** A small vocabulary on purpose: what a venue's own team does on the day. */
export const ROTA_SKILLS = ["setup", "bar", "duty_manager", "first_aid", "av"] as const;
export const RotaSkillSchema = z.enum(ROTA_SKILLS);
export type RotaSkill = z.infer<typeof RotaSkillSchema>;

export const ROTA_SKILL_LABELS: Readonly<Record<RotaSkill, string>> = {
  setup: "Set-up",
  bar: "Bar",
  duty_manager: "Duty manager",
  first_aid: "First aid",
  av: "AV",
};

export const STAFF_EMPLOYMENT_TYPES = ["employed", "casual", "agency"] as const;
export const StaffEmploymentTypeSchema = z.enum(STAFF_EMPLOYMENT_TYPES);
export type StaffEmploymentType = z.infer<typeof StaffEmploymentTypeSchema>;

export const STAFF_EMPLOYMENT_LABELS: Readonly<Record<StaffEmploymentType, string>> = {
  employed: "Employed",
  casual: "Casual",
  agency: "Agency",
};

export const ROTA_SHIFT_STATUSES = ["draft", "published", "cancelled"] as const;
export const RotaShiftStatusSchema = z.enum(ROTA_SHIFT_STATUSES);
export type RotaShiftStatus = z.infer<typeof RotaShiftStatusSchema>;

export const STAFF_UNAVAILABILITY_REASONS = ["leave", "unavailable"] as const;
export const StaffUnavailabilityReasonSchema = z.enum(STAFF_UNAVAILABILITY_REASONS);
export type StaffUnavailabilityReason = z.infer<typeof StaffUnavailabilityReasonSchema>;

export const STAFF_UNAVAILABILITY_LABELS: Readonly<Record<StaffUnavailabilityReason, string>> = {
  leave: "On leave",
  unavailable: "Unavailable",
};

/** Warnings a rota manager may keep, with a recorded reason. */
export const ROTA_WARNING_CODES = [
  "short_rest",
  "double_booked",
  "no_break",
  "no_day_off",
  "long_average",
  "young_long_day",
  "young_long_week",
  "young_night",
  "bar_training",
  "right_to_work_expired",
  "unavailable",
] as const;
export const RotaWarningCodeSchema = z.enum(ROTA_WARNING_CODES);
export type RotaWarningCode = z.infer<typeof RotaWarningCodeSchema>;

/** The legal blocks. Nobody can keep these: the shift has to change. */
export const ROTA_BLOCK_CODES = ["young_small_hours", "right_to_work_missing"] as const;
export const RotaBlockCodeSchema = z.enum(ROTA_BLOCK_CODES);
export type RotaBlockCode = z.infer<typeof RotaBlockCodeSchema>;

export const RotaIssueCodeSchema = z.enum([...ROTA_WARNING_CODES, ...ROTA_BLOCK_CODES]);
export type RotaIssueCode = z.infer<typeof RotaIssueCodeSchema>;

export const ROTA_ISSUE_SEVERITIES = ["warning", "block"] as const;
export const RotaIssueSeveritySchema = z.enum(ROTA_ISSUE_SEVERITIES);
export type RotaIssueSeverity = z.infer<typeof RotaIssueSeveritySchema>;

/** The longest shift the rota holds, and the longest break within one. */
export const ROTA_SHIFT_MAX_MINUTES = 24 * 60;
export const ROTA_BREAK_MAX_MINUTES = 12 * 60;
/** The longest single stretch of leave or unavailability. */
export const STAFF_UNAVAILABILITY_MAX_DAYS = 366;

// ---------------------------------------------------------------------------
// What the API sends
// ---------------------------------------------------------------------------

/** A warning someone chose to keep: who, when and why. */
export const RotaKeptWarningSchema = z.object({
  code: RotaWarningCodeSchema,
  reason: z.string().min(1).max(300),
  byUserId: z.string().uuid().nullable(),
  byName: z.string().nullable(),
  at: IsoInstantSchema,
});
export type RotaKeptWarning = z.infer<typeof RotaKeptWarningSchema>;

export const RotaIssueSchema = z.object({
  code: RotaIssueCodeSchema,
  severity: RotaIssueSeveritySchema,
  /** One plain sentence: "Morag would have 9 hours between Friday's bar
   *  shift and Saturday's set-up; 11 are needed." */
  message: z.string().min(1).max(400),
  /** A few words for the rota's cell: "9 h rest before; 11 needed". */
  short: z.string().min(1).max(60),
  kept: RotaKeptWarningSchema.nullable(),
});
export type RotaIssue = z.infer<typeof RotaIssueSchema>;

/** Everything a rota manager keeps about a person. */
export const StaffRecordSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  /** The linked account, when it still belongs to this venue. */
  account: z.object({ name: z.string(), email: z.string() }).nullable(),
  displayName: z.string().min(1).max(120),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  employmentType: StaffEmploymentTypeSchema,
  skills: z.array(RotaSkillSchema),
  barTrainedOn: CalendarDateSchema.nullable(),
  turns18On: CalendarDateSchema.nullable(),
  rightToWorkCheckedOn: CalendarDateSchema.nullable(),
  rightToWorkExpiresOn: CalendarDateSchema.nullable(),
  workingTimeOptOut: z.boolean(),
  isActive: z.boolean(),
  revision: z.number().int().min(1),
  updatedAt: IsoInstantSchema,
});
export type StaffRecord = z.infer<typeof StaffRecordSchema>;

/** What everyone who reads the rota sees of a person. */
export const RotaPersonSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(120),
  employmentType: StaffEmploymentTypeSchema,
  skills: z.array(RotaSkillSchema),
  isActive: z.boolean(),
  /** Linked to an account at this venue, so publishing tells them in the app. */
  hasAccount: z.boolean(),
});
export type RotaPerson = z.infer<typeof RotaPersonSchema>;

export const RotaShiftSchema = z.object({
  id: z.string().uuid(),
  venueId: z.string().uuid(),
  /** Null for a need nobody fills yet. */
  staffMemberId: z.string().uuid().nullable(),
  role: RotaSkillSchema,
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  breakMinutes: z.number().int().min(0).max(ROTA_BREAK_MAX_MINUTES),
  eventId: z.string().uuid().nullable(),
  eventName: z.string().nullable(),
  spaceId: z.string().uuid().nullable(),
  spaceName: z.string().nullable(),
  note: z.string().nullable(),
  status: RotaShiftStatusSchema,
  revision: z.number().int().min(1),
  publishedAt: IsoInstantSchema.nullable(),
  cancelledAt: IsoInstantSchema.nullable(),
  cancellationNoticeHours: z.number().int().min(0).nullable(),
  updatedAt: IsoInstantSchema,
  updatedByName: z.string().nullable(),
  /** Only for those who manage the rota; empty for everyone else. */
  issues: z.array(RotaIssueSchema),
});
export type RotaShift = z.infer<typeof RotaShiftSchema>;

export const StaffUnavailabilitySchema = z.object({
  id: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  reason: StaffUnavailabilityReasonSchema,
  note: z.string().nullable(),
});
export type StaffUnavailability = z.infer<typeof StaffUnavailabilitySchema>;

/**
 * manage — the venue's administrators: drafts, records and warnings.
 * read   — everyone on the venue floor: the published week.
 * own    — anyone else linked to a person on the rota: their own shifts.
 */
export const ROTA_ACCESS_LEVELS = ["manage", "read", "own"] as const;
export const RotaAccessSchema = z.enum(ROTA_ACCESS_LEVELS);
export type RotaAccess = z.infer<typeof RotaAccessSchema>;

export const RotaWeekSchema = z.object({
  venueId: z.string().uuid(),
  /** The venue's zone; every day, time and check on the rota is in it. */
  timeZone: z.string().min(1),
  /** The Monday that starts the week, in the venue's zone. */
  weekStart: CalendarDateSchema,
  from: IsoInstantSchema,
  to: IsoInstantSchema,
  access: RotaAccessSchema,
  people: z.array(RotaPersonSchema),
  /** Every staff record of the venue, for those who manage the rota. */
  records: z.array(StaffRecordSchema),
  shifts: z.array(RotaShiftSchema),
  unavailability: z.array(StaffUnavailabilitySchema),
  rooms: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  /** Accounts of the venue's team that a record may be linked to. */
  accounts: z.array(z.object({ id: z.string().uuid(), name: z.string(), email: z.string() })),
});
export type RotaWeek = z.infer<typeof RotaWeekSchema>;

export const RotaPublishResultSchema = z.object({
  published: z.number().int().min(0),
  /** People told in the app: one notification each. */
  told: z.number().int().min(0),
  /** People on the published shifts with no account to tell. */
  notTold: z.number().int().min(0),
});
export type RotaPublishResult = z.infer<typeof RotaPublishResultSchema>;

// ---------------------------------------------------------------------------
// What the API accepts
// ---------------------------------------------------------------------------

const NoteSchema = z.string().trim().min(1).max(500).nullable();

function refineShiftTimes(
  value: { readonly startsAt?: string; readonly endsAt?: string; readonly breakMinutes?: number },
  ctx: z.RefinementCtx,
): void {
  if (value.startsAt === undefined || value.endsAt === undefined) return;
  const minutes = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 60_000;
  if (!(minutes > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "A shift ends after it starts." });
    return;
  }
  if (minutes > ROTA_SHIFT_MAX_MINUTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "A shift is at most 24 hours long." });
  }
  if (value.breakMinutes !== undefined && value.breakMinutes >= minutes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["breakMinutes"], message: "The break is shorter than the shift." });
  }
}

const ShiftFieldsSchema = z.object({
  staffMemberId: z.string().uuid().nullable(),
  role: RotaSkillSchema,
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  breakMinutes: z.number().int().min(0).max(ROTA_BREAK_MAX_MINUTES),
  eventId: z.string().uuid().nullable(),
  spaceId: z.string().uuid().nullable(),
  note: NoteSchema,
});

export const CreateRotaShiftSchema = ShiftFieldsSchema.strict().superRefine(refineShiftTimes);
export type CreateRotaShift = z.infer<typeof CreateRotaShiftSchema>;

/** A change to one shift, made from the copy the editor last saw. */
export const UpdateRotaShiftSchema = ShiftFieldsSchema.partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict()
  .superRefine(refineShiftTimes);
export type UpdateRotaShift = z.infer<typeof UpdateRotaShiftSchema>;

export const CancelRotaShiftSchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();
export type CancelRotaShift = z.infer<typeof CancelRotaShiftSchema>;

export const KeepRotaWarningSchema = z.object({
  code: RotaWarningCodeSchema,
  reason: z.string().trim().min(3, "Say briefly why").max(300),
  expectedRevision: z.number().int().min(1),
}).strict();
export type KeepRotaWarning = z.infer<typeof KeepRotaWarningSchema>;

/** Publish exactly the drafts the person was shown, as they were shown. */
export const PublishRotaWeekSchema = z.object({
  weekStart: CalendarDateSchema,
  shifts: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().min(1) }).strict()).min(1).max(1000),
}).strict();
export type PublishRotaWeek = z.infer<typeof PublishRotaWeekSchema>;

const OptionalText = (max: number) => z.string().trim().max(max).nullable()
  .transform((value) => value === null || value === "" ? null : value);

const StaffFieldsSchema = z.object({
  displayName: z.string().trim().min(1, "Give their name").max(120),
  email: z.string().trim().max(255).email("Check the email address").nullable()
    .or(z.literal("").transform(() => null)),
  phone: OptionalText(40),
  employmentType: StaffEmploymentTypeSchema,
  skills: z.array(RotaSkillSchema).max(ROTA_SKILLS.length)
    .transform((skills) => ROTA_SKILLS.filter((skill) => skills.includes(skill))),
  barTrainedOn: CalendarDateSchema.nullable(),
  turns18On: CalendarDateSchema.nullable(),
  rightToWorkCheckedOn: CalendarDateSchema.nullable(),
  rightToWorkExpiresOn: CalendarDateSchema.nullable(),
  workingTimeOptOut: z.boolean(),
  userId: z.string().uuid().nullable(),
});

function refineRightToWork(
  value: { readonly rightToWorkCheckedOn?: string | null; readonly rightToWorkExpiresOn?: string | null },
  ctx: z.RefinementCtx,
): void {
  const checked = value.rightToWorkCheckedOn;
  const expires = value.rightToWorkExpiresOn;
  if (expires === undefined || expires === null) return;
  if (checked === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rightToWorkExpiresOn"], message: "Record the check before its expiry." });
  } else if (checked !== undefined && expires < checked) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rightToWorkExpiresOn"], message: "The expiry comes after the check." });
  }
}

export const CreateStaffMemberSchema = StaffFieldsSchema.strict().superRefine(refineRightToWork);
/** What the web sends. */
export type CreateStaffMember = z.input<typeof CreateStaffMemberSchema>;
/** What the server has once it is validated: skills in order, blanks as null. */
export type CreateStaffMemberBody = z.output<typeof CreateStaffMemberSchema>;

export const UpdateStaffMemberSchema = StaffFieldsSchema.partial()
  .extend({ isActive: z.boolean().optional(), expectedRevision: z.number().int().min(1) })
  .strict()
  .superRefine(refineRightToWork);
export type UpdateStaffMember = z.input<typeof UpdateStaffMemberSchema>;
export type UpdateStaffMemberBody = z.output<typeof UpdateStaffMemberSchema>;

export const CreateStaffUnavailabilitySchema = z.object({
  staffMemberId: z.string().uuid(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  reason: StaffUnavailabilityReasonSchema,
  note: z.string().trim().min(1).max(300).nullable(),
}).strict().superRefine((value, ctx) => {
  const days = (Date.parse(value.endsAt) - Date.parse(value.startsAt)) / 86_400_000;
  if (!(days > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "The end comes after the start." });
  else if (days > STAFF_UNAVAILABILITY_MAX_DAYS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "Enter at most a year at a time." });
  }
});
export type CreateStaffUnavailability = z.infer<typeof CreateStaffUnavailabilitySchema>;

export const RotaWeekQuerySchema = z.object({ start: CalendarDateSchema.optional() }).strict();
export type RotaWeekQuery = z.infer<typeof RotaWeekQuerySchema>;
