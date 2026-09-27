import {
  CalendarResponseSchema,
  RotaShiftSchema,
  RotaWeekSchema,
  StaffRecordSchema,
  type CalendarResponse,
  type RotaIssue,
  type RotaShift,
  type RotaWeek,
  type StaffRecord,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// A small week at the Hall for the Rota's component tests, parsed through the
// shared schemas so a fixture can never drift from what the API sends.
// ---------------------------------------------------------------------------

export const VENUE = "00000000-0000-4000-8000-000000000100";
export const HALL = "00000000-0000-4000-8000-000000000001";
export const WEDDING_EVENT = "00000000-0000-4000-8000-0000000000e1";
export const MORAG = "00000000-0000-4000-8000-0000000000a1";
export const JAMIE = "00000000-0000-4000-8000-0000000000a2";
export const CALLUM = "00000000-0000-4000-8000-0000000000a3";
export const MORAG_USER = "00000000-0000-4000-8000-0000000000c1";
export const TZ = "Europe/London";
export const WEEK_START = "2026-10-05";

export const SHORT_REST: RotaIssue = {
  code: "short_rest", severity: "warning", kept: null, short: "9 h rest before; 11 needed",
  message: "Morag Sinclair would have 9 hours between Friday's bar shift and Saturday's set-up; 11 are needed.",
};

export const NO_CHECK: RotaIssue = {
  code: "right_to_work_missing", severity: "block", kept: null, short: "No right-to-work check",
  message: "Callum Reid has no right-to-work check recorded, so this shift cannot be published yet.",
};

export function record(fields: Partial<StaffRecord> & Pick<StaffRecord, "id" | "displayName">): StaffRecord {
  return StaffRecordSchema.parse({
    venueId: VENUE, userId: null, account: null, email: null, phone: null, employmentType: "casual", skills: ["setup"],
    barTrainedOn: null, turns18On: null, rightToWorkCheckedOn: "2025-03-01", rightToWorkExpiresOn: null,
    workingTimeOptOut: false, isActive: true, revision: 1, updatedAt: "2026-09-01T09:00:00.000Z",
    ...fields,
  });
}

export const RECORDS: readonly StaffRecord[] = [
  record({ id: MORAG, displayName: "Morag Sinclair", employmentType: "employed", skills: ["setup", "bar"], barTrainedOn: "2025-04-01",
    userId: MORAG_USER, account: { name: "Morag Sinclair", email: "morag@tradeshall.example" } }),
  record({ id: JAMIE, displayName: "Jamie Kerr", employmentType: "agency", skills: ["av"] }),
  record({ id: CALLUM, displayName: "Callum Reid", rightToWorkCheckedOn: null }),
];

export function shift(fields: Partial<RotaShift> & Pick<RotaShift, "id">): RotaShift {
  return RotaShiftSchema.parse({
    venueId: VENUE, staffMemberId: null, role: "setup",
    startsAt: "2026-10-10T07:30:00.000Z", endsAt: "2026-10-10T15:00:00.000Z", breakMinutes: 20,
    eventId: null, eventName: null, spaceId: HALL, spaceName: "Grand Hall", note: null,
    status: "draft", revision: 1, publishedAt: null, cancelledAt: null, cancellationNoticeHours: null,
    updatedAt: "2026-10-01T09:00:00.000Z", updatedByName: null, issues: [],
    ...fields,
  });
}

export const MORAG_SATURDAY = shift({ id: "00000000-0000-4000-8000-0000000000b1", staffMemberId: MORAG, issues: [SHORT_REST] });
export const UNFILLED_BAR = shift({ id: "00000000-0000-4000-8000-0000000000b2", role: "bar", startsAt: "2026-10-10T17:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z" });
export const CALLUM_FRIDAY = shift({ id: "00000000-0000-4000-8000-0000000000b3", staffMemberId: CALLUM, startsAt: "2026-10-09T08:00:00.000Z", endsAt: "2026-10-09T12:00:00.000Z", breakMinutes: 0, issues: [NO_CHECK] });

export function rotaWeek(fields: Partial<RotaWeek> = {}): RotaWeek {
  const records = fields.records ?? RECORDS;
  return RotaWeekSchema.parse({
    venueId: VENUE, timeZone: TZ, weekStart: WEEK_START, from: "2026-10-04T23:00:00.000Z", to: "2026-10-11T23:00:00.000Z",
    access: "manage",
    people: records.map((one) => ({
      id: one.id, displayName: one.displayName, employmentType: one.employmentType, skills: one.skills, isActive: one.isActive,
      hasAccount: one.account !== null,
    })),
    records,
    shifts: [MORAG_SATURDAY, UNFILLED_BAR, CALLUM_FRIDAY],
    unavailability: [],
    rooms: [{ id: HALL, name: "Grand Hall" }],
    accounts: [],
    ...fields,
  });
}

export function hallCalendar(): CalendarResponse {
  return CalendarResponseSchema.parse({
    venueId: VENUE, range: { from: "2026-10-04T23:00:00.000Z", to: "2026-10-11T23:00:00.000Z" },
    rooms: [{ id: HALL, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 }],
    entries: [{
      entryType: "booking", id: "00000000-0000-4000-8000-0000000009b1", spaceId: HALL, kind: "ink", status: "active", state: "ink",
      title: "Wedding", eventType: "wedding", startsAt: "2026-10-10T11:00:00.000Z", endsAt: "2026-10-10T23:30:00.000Z",
      rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
      eventId: WEDDING_EVENT, seriesId: null, eventName: "Robertson and Kaur wedding", guestCount: 160,
    }, {
      entryType: "booking", id: "00000000-0000-4000-8000-0000000009b2", spaceId: HALL, kind: "hold", status: "active", state: "hold",
      title: "Charity quiz night", eventType: null, startsAt: "2026-10-08T18:00:00.000Z", endsAt: "2026-10-08T21:30:00.000Z",
      rank: null, jointFlag: false, decisionAt: "2026-10-01T09:00:00.000Z", ownerUserId: null, nextAction: null, nextActionDueAt: null,
      eventId: null, seriesId: null,
    }, {
      entryType: "booking", id: "00000000-0000-4000-8000-0000000009b3", spaceId: HALL, kind: "prospect", status: "active", state: "prospect",
      title: "Enquiry for a ceilidh", eventType: null, startsAt: "2026-10-09T18:00:00.000Z", endsAt: "2026-10-09T22:00:00.000Z",
      rank: null, jointFlag: false, decisionAt: null, ownerUserId: null, nextAction: null, nextActionDueAt: null,
      eventId: null, seriesId: null,
    }],
    conflicts: { conflicts: [], checks: { inkDoubleBook: { status: "checked" }, holdOverlap: { status: "checked" }, turnaround: { status: "checked", uncoveredPairCount: 0, detail: "" } } },
  });
}
