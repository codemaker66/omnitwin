import { describe, expect, it } from "vitest";
import {
  CreateRotaShiftSchema,
  CreateStaffMemberSchema,
  CreateStaffUnavailabilitySchema,
  KeepRotaWarningSchema,
  PublishRotaWeekSchema,
  ROTA_BLOCK_CODES,
  ROTA_SKILLS,
  ROTA_SKILL_LABELS,
  ROTA_WARNING_CODES,
  RotaWeekQuerySchema,
  UpdateRotaShiftSchema,
  UpdateStaffMemberSchema,
} from "../staff-rota.js";

// ---------------------------------------------------------------------------
// The rota's API contract: what a shift, a person and a publish may carry.
// The server validates with these at the boundary; the web sends them.
// ---------------------------------------------------------------------------

const PERSON = "00000000-0000-4000-8000-000000000001";

const SHIFT = {
  staffMemberId: PERSON,
  role: "bar",
  startsAt: "2026-10-10T16:00:00.000Z",
  endsAt: "2026-10-10T22:30:00.000Z",
  breakMinutes: 20,
  eventId: null,
  spaceId: null,
  note: null,
} as const;

const RECORD = {
  displayName: "Morag Sinclair",
  email: "morag@example.test",
  phone: null,
  employmentType: "casual",
  skills: ["bar", "setup"],
  barTrainedOn: "2025-03-01",
  turns18On: null,
  rightToWorkCheckedOn: "2025-02-01",
  rightToWorkExpiresOn: null,
  workingTimeOptOut: false,
  userId: null,
} as const;

describe("shifts", () => {
  it("accepts a shift, filled or not", () => {
    expect(CreateRotaShiftSchema.safeParse(SHIFT).success).toBe(true);
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, staffMemberId: null }).success).toBe(true);
  });

  it("refuses a shift that ends before it starts, runs past a day, or breaks for longer than it runs", () => {
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, endsAt: SHIFT.startsAt }).success).toBe(false);
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, endsAt: "2026-10-11T16:01:00.000Z" }).success).toBe(false);
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, breakMinutes: 390 }).success).toBe(false);
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, breakMinutes: -5 }).success).toBe(false);
  });

  it("knows only the rota's roles, and nothing it was not asked for", () => {
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, role: "juggling" }).success).toBe(false);
    expect(CreateRotaShiftSchema.safeParse({ ...SHIFT, status: "published" }).success).toBe(false);
    expect(ROTA_SKILLS.map((skill) => ROTA_SKILL_LABELS[skill])).toEqual(["Set-up", "Bar", "Duty manager", "First aid", "AV"]);
  });

  it("takes a change with the revision the editor saw", () => {
    expect(UpdateRotaShiftSchema.safeParse({ breakMinutes: 30, expectedRevision: 2 }).success).toBe(true);
    expect(UpdateRotaShiftSchema.safeParse({ breakMinutes: 30 }).success).toBe(false);
    expect(UpdateRotaShiftSchema.safeParse({ ...SHIFT, endsAt: SHIFT.startsAt, expectedRevision: 1 }).success).toBe(false);
  });
});

describe("keeping a warning and publishing", () => {
  it("keeps a warning with a reason, never a legal block", () => {
    expect(KeepRotaWarningSchema.safeParse({ code: "short_rest", reason: "Rest given back on Monday", expectedRevision: 1 }).success).toBe(true);
    expect(KeepRotaWarningSchema.safeParse({ code: "short_rest", reason: " ", expectedRevision: 1 }).success).toBe(false);
    for (const code of ROTA_BLOCK_CODES) {
      expect(KeepRotaWarningSchema.safeParse({ code, reason: "Because", expectedRevision: 1 }).success, code).toBe(false);
    }
    expect(new Set([...ROTA_WARNING_CODES, ...ROTA_BLOCK_CODES]).size).toBe(ROTA_WARNING_CODES.length + ROTA_BLOCK_CODES.length);
  });

  it("publishes named shifts at named revisions in a real week", () => {
    expect(PublishRotaWeekSchema.safeParse({ weekStart: "2026-10-05", shifts: [{ id: PERSON, revision: 1 }] }).success).toBe(true);
    expect(PublishRotaWeekSchema.safeParse({ weekStart: "2026-10-05", shifts: [] }).success).toBe(false);
    expect(PublishRotaWeekSchema.safeParse({ weekStart: "2026-02-30", shifts: [{ id: PERSON, revision: 1 }] }).success).toBe(false);
    expect(RotaWeekQuerySchema.safeParse({ start: "5 October" }).success).toBe(false);
    expect(RotaWeekQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe("people", () => {
  it("tidies skills into the rota's order and treats an empty email as none", () => {
    const parsed = CreateStaffMemberSchema.parse({ ...RECORD, email: "", skills: ["setup", "bar", "setup"] });
    expect(parsed.skills).toEqual(["setup", "bar"]);
    expect(parsed.email).toBeNull();
  });

  it("refuses an expiry without a check, or before it", () => {
    expect(CreateStaffMemberSchema.safeParse({ ...RECORD, rightToWorkCheckedOn: null, rightToWorkExpiresOn: "2027-01-01" }).success).toBe(false);
    expect(CreateStaffMemberSchema.safeParse({ ...RECORD, rightToWorkExpiresOn: "2025-01-01" }).success).toBe(false);
    expect(CreateStaffMemberSchema.safeParse({ ...RECORD, rightToWorkExpiresOn: "2027-01-01" }).success).toBe(true);
  });

  it("asks for a name and a real email", () => {
    expect(CreateStaffMemberSchema.safeParse({ ...RECORD, displayName: "  " }).success).toBe(false);
    expect(CreateStaffMemberSchema.safeParse({ ...RECORD, email: "morag at example" }).success).toBe(false);
  });

  it("changes a record from the revision the editor saw", () => {
    expect(UpdateStaffMemberSchema.safeParse({ isActive: false, expectedRevision: 3 }).success).toBe(true);
    expect(UpdateStaffMemberSchema.safeParse({ isActive: false }).success).toBe(false);
  });
});

describe("leave and unavailability", () => {
  it("runs forwards, for at most a year", () => {
    const leave = { staffMemberId: PERSON, reason: "leave", note: null, startsAt: "2026-10-08T23:00:00.000Z", endsAt: "2026-10-11T23:00:00.000Z" };
    expect(CreateStaffUnavailabilitySchema.safeParse(leave).success).toBe(true);
    expect(CreateStaffUnavailabilitySchema.safeParse({ ...leave, endsAt: leave.startsAt }).success).toBe(false);
    expect(CreateStaffUnavailabilitySchema.safeParse({ ...leave, endsAt: "2027-12-01T00:00:00.000Z" }).success).toBe(false);
    expect(CreateStaffUnavailabilitySchema.safeParse({ ...leave, reason: "sick" }).success).toBe(false);
  });
});
