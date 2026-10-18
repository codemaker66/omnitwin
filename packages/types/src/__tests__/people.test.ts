import { describe, expect, it } from "vitest";
import {
  ContactPointInputSchema, CreatePersonSchema, PersonProfileSchema, SetMembershipsSchema, UpdatePersonSchema,
  isUsablePhone, normaliseEmail, normalisePhone,
} from "../people.js";

const VENUE = "00000000-0000-4000-8000-0000000000a1";
const ORG_A = "00000000-0000-4000-8000-0000000000b1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

describe("normaliseEmail", () => {
  it("lowercases and trims, and gives none for a blank", () => {
    expect(normaliseEmail(" Aileen.Murray@Example.TEST ")).toBe("aileen.murray@example.test");
    expect(normaliseEmail("\tkirsty@example.test\n")).toBe("kirsty@example.test");
    for (const blank of ["", "   ", null, undefined]) expect(normaliseEmail(blank)).toBeNull();
  });
});

const PHONE_CASES = [
  ["07700 900123", "07700900123"], ["+44 7700 900123", "07700900123"], ["0044 7700 900123", "07700900123"],
  ["00 44 7700 900123", "07700900123"], ["+44 (0)141 496 0000", "01414960000"], ["+44 0141 496 0000", "01414960000"],
  ["(0141) 496-0000", "01414960000"], ["+1 (212) 555-0100", "+12125550100"], ["44 141 496 0000", "441414960000"],
  ["0141 496 0000 ext 12", "0141496000012"], ["+44", null], ["+", null], ["  ", null], ["", null],
] as const;

describe("normalisePhone", () => {
  it.each(PHONE_CASES)("%s is %s", (raw, expected) => { expect(normalisePhone(raw)).toBe(expected); });
  it("gives none for no value", () => { expect(normalisePhone(null)).toBeNull(); expect(normalisePhone(undefined)).toBeNull(); });
  it("takes 6 to 15 digits as a usable number", () => {
    expect(isUsablePhone("07700 900123")).toBe(true);
    expect(isUsablePhone("+1 (212) 555-0100")).toBe(true);
    expect(isUsablePhone("12345")).toBe(false);
    expect(isUsablePhone("+44 7700 900123 456789")).toBe(false);
    expect(isUsablePhone("call me")).toBe(false);
  });
});

describe("the people contracts", () => {
  it("takes an email or a usable phone as a contact point", () => {
    expect(ContactPointInputSchema.parse({ kind: "email", value: " Aileen.Murray@Example.TEST " }))
      .toEqual({ kind: "email", value: "Aileen.Murray@Example.TEST", label: "other", isPrimary: false });
    expect(ContactPointInputSchema.safeParse({ kind: "phone", value: "123" }).success).toBe(false);
    expect(ContactPointInputSchema.safeParse({ kind: "email", value: "not an email" }).success).toBe(false);
    expect(ContactPointInputSchema.safeParse({ kind: "fax", value: "0141 496 0000" }).success).toBe(false);
  });
  it("needs a name and turns blank optional text into none", () => {
    expect(CreatePersonSchema.parse({ venueId: VENUE, name: " Aileen Murray ", jobTitle: "  " }))
      .toMatchObject({ name: "Aileen Murray", jobTitle: null, contactPoints: [] });
    expect(CreatePersonSchema.safeParse({ venueId: VENUE, name: "   " }).success).toBe(false);
  });
  it("refuses an edit that changes nothing", () => {
    expect(UpdatePersonSchema.safeParse({ expectedUpdatedAt: "2026-10-18T09:00:00.000Z" }).success).toBe(false);
  });
  it("allows one primary organisation, and each organisation once", () => {
    expect(SetMembershipsSchema.safeParse({ memberships: [{ organisationId: ORG_A, isPrimary: true }, { organisationId: ORG_B, isPrimary: true }] }).success).toBe(false);
    expect(SetMembershipsSchema.safeParse({ memberships: [{ organisationId: ORG_A }, { organisationId: ORG_A }] }).success).toBe(false);
    expect(SetMembershipsSchema.parse({ memberships: [] })).toEqual({ memberships: [] });
  });
  it("reads a merged person as where they went", () => {
    const merged = PersonProfileSchema.parse({ status: "merged", mergedInto: { id: ORG_A, name: "Aileen Murray" }, mergeId: ORG_B, mergedAt: "2026-10-18T09:00:00.000Z" });
    expect(merged.status).toBe("merged");
  });
});
