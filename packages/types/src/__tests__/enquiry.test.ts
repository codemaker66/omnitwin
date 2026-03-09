import { describe, it, expect } from "vitest";
import {
  EnquiryIdSchema,
  ENQUIRY_STATUSES,
  EnquiryStatusSchema,
  VALID_ENQUIRY_TRANSITIONS,
  isValidEnquiryTransition,
  EnquirySchema,
  CreateEnquirySchema,
} from "../enquiry.js";
import type { EnquiryStatus } from "../enquiry.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const VALID_VENUE_UUID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const VALID_SPACE_UUID = "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f";
const VALID_CONFIG_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";
const VALID_USER_UUID = "e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091";
const VALID_DATETIME = "2025-01-15T10:30:00.000Z";

const validEnquiry = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  configurationId: VALID_CONFIG_UUID,
  name: "John Doe",
  email: "john@example.com",
  phone: "+44 7911 123456",
  message: "We would like to book the Grand Hall for a wedding.",
  eventDate: "2025-06-15T14:00:00.000Z",
  guestCount: 150,
  status: "submitted" as const,
  respondedBy: null,
  respondedAt: null,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateEnquiry = {
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  configurationId: null,
  name: "John Doe",
  email: "john@example.com",
  message: "We would like to book the Grand Hall.",
  eventDate: "2025-06-15T14:00:00.000Z",
  guestCount: 150,
};

// ---------------------------------------------------------------------------
// EnquiryIdSchema
// ---------------------------------------------------------------------------

describe("EnquiryIdSchema", () => {
  it("accepts a valid UUID", () => {
    expect(EnquiryIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(EnquiryIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(EnquiryIdSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EnquiryStatusSchema
// ---------------------------------------------------------------------------

describe("EnquiryStatusSchema", () => {
  it.each(ENQUIRY_STATUSES)("accepts '%s'", (status) => {
    expect(EnquiryStatusSchema.safeParse(status).success).toBe(true);
  });

  it("has exactly 5 statuses", () => {
    expect(ENQUIRY_STATUSES).toHaveLength(5);
  });

  it("contains the expected statuses in order", () => {
    expect(ENQUIRY_STATUSES).toEqual(["submitted", "viewed", "responded", "converted", "lost"]);
  });

  it("rejects 'Submitted' (case sensitive)", () => {
    expect(EnquiryStatusSchema.safeParse("Submitted").success).toBe(false);
  });

  it("rejects 'pending' (not a valid status)", () => {
    expect(EnquiryStatusSchema.safeParse("pending").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(EnquiryStatusSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(EnquiryStatusSchema.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VALID_ENQUIRY_TRANSITIONS — state machine
// ---------------------------------------------------------------------------

describe("VALID_ENQUIRY_TRANSITIONS", () => {
  it("defines transitions for all 5 statuses", () => {
    expect(Object.keys(VALID_ENQUIRY_TRANSITIONS)).toHaveLength(5);
  });

  it("submitted can only transition to viewed", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.submitted).toEqual(["viewed"]);
  });

  it("viewed can transition to responded or lost", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.viewed).toEqual(["responded", "lost"]);
  });

  it("responded can transition to converted or lost", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.responded).toEqual(["converted", "lost"]);
  });

  it("converted is terminal (no transitions)", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.converted).toEqual([]);
  });

  it("lost is terminal (no transitions)", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.lost).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidEnquiryTransition
// ---------------------------------------------------------------------------

describe("isValidEnquiryTransition", () => {
  // --- Legal transitions ---
  it("submitted → viewed is valid", () => {
    expect(isValidEnquiryTransition("submitted", "viewed")).toBe(true);
  });

  it("viewed → responded is valid", () => {
    expect(isValidEnquiryTransition("viewed", "responded")).toBe(true);
  });

  it("viewed → lost is valid", () => {
    expect(isValidEnquiryTransition("viewed", "lost")).toBe(true);
  });

  it("responded → converted is valid", () => {
    expect(isValidEnquiryTransition("responded", "converted")).toBe(true);
  });

  it("responded → lost is valid", () => {
    expect(isValidEnquiryTransition("responded", "lost")).toBe(true);
  });

  // --- Illegal transitions ---
  it("submitted → responded is invalid (must go through viewed)", () => {
    expect(isValidEnquiryTransition("submitted", "responded")).toBe(false);
  });

  it("submitted → converted is invalid (skips steps)", () => {
    expect(isValidEnquiryTransition("submitted", "converted")).toBe(false);
  });

  it("submitted → lost is invalid (must be viewed first)", () => {
    expect(isValidEnquiryTransition("submitted", "lost")).toBe(false);
  });

  it("submitted → submitted is invalid (self-transition)", () => {
    expect(isValidEnquiryTransition("submitted", "submitted")).toBe(false);
  });

  it("viewed → viewed is invalid (self-transition)", () => {
    expect(isValidEnquiryTransition("viewed", "viewed")).toBe(false);
  });

  it("viewed → converted is invalid (must respond first)", () => {
    expect(isValidEnquiryTransition("viewed", "converted")).toBe(false);
  });

  it("viewed → submitted is invalid (backward)", () => {
    expect(isValidEnquiryTransition("viewed", "submitted")).toBe(false);
  });

  it("responded → submitted is invalid (backward)", () => {
    expect(isValidEnquiryTransition("responded", "submitted")).toBe(false);
  });

  it("responded → viewed is invalid (backward)", () => {
    expect(isValidEnquiryTransition("responded", "viewed")).toBe(false);
  });

  it("converted → anything is invalid (terminal)", () => {
    const allStatuses: EnquiryStatus[] = ["submitted", "viewed", "responded", "converted", "lost"];
    for (const status of allStatuses) {
      expect(isValidEnquiryTransition("converted", status)).toBe(false);
    }
  });

  it("lost → anything is invalid (terminal)", () => {
    const allStatuses: EnquiryStatus[] = ["submitted", "viewed", "responded", "converted", "lost"];
    for (const status of allStatuses) {
      expect(isValidEnquiryTransition("lost", status)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// EnquirySchema — full entity
// ---------------------------------------------------------------------------

describe("EnquirySchema", () => {
  it("accepts a fully valid enquiry", () => {
    const result = EnquirySchema.safeParse(validEnquiry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("John Doe");
      expect(result.data.status).toBe("submitted");
      expect(result.data.guestCount).toBe(150);
    }
  });

  it("accepts null configurationId", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, configurationId: null }).success).toBe(true);
  });

  it("accepts responded enquiry with respondedBy and respondedAt", () => {
    const responded = {
      ...validEnquiry,
      status: "responded",
      respondedBy: VALID_USER_UUID,
      respondedAt: "2025-01-20T09:00:00.000Z",
    };
    const result = EnquirySchema.safeParse(responded);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.respondedBy).toBe(VALID_USER_UUID);
    }
  });

  it("defaults phone to empty string when omitted", () => {
    const { phone: _, ...noPhone } = validEnquiry;
    const result = EnquirySchema.safeParse(noPhone);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("");
    }
  });

  it("trims whitespace from name", () => {
    const result = EnquirySchema.safeParse({ ...validEnquiry, name: "  John Doe  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("John Doe");
    }
  });

  it("trims whitespace from message", () => {
    const result = EnquirySchema.safeParse({ ...validEnquiry, message: "  Hello  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe("Hello");
    }
  });

  // --- Missing required fields ---

  it("rejects missing id", () => {
    const { id: _, ...noId } = validEnquiry;
    expect(EnquirySchema.safeParse(noId).success).toBe(false);
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validEnquiry;
    expect(EnquirySchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing spaceId", () => {
    const { spaceId: _, ...noSpaceId } = validEnquiry;
    expect(EnquirySchema.safeParse(noSpaceId).success).toBe(false);
  });

  it("rejects missing configurationId (required but nullable)", () => {
    const { configurationId: _, ...noConfigId } = validEnquiry;
    expect(EnquirySchema.safeParse(noConfigId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validEnquiry;
    expect(EnquirySchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email: _, ...noEmail } = validEnquiry;
    expect(EnquirySchema.safeParse(noEmail).success).toBe(false);
  });

  it("rejects missing message", () => {
    const { message: _, ...noMessage } = validEnquiry;
    expect(EnquirySchema.safeParse(noMessage).success).toBe(false);
  });

  it("rejects missing eventDate", () => {
    const { eventDate: _, ...noEventDate } = validEnquiry;
    expect(EnquirySchema.safeParse(noEventDate).success).toBe(false);
  });

  it("rejects missing guestCount", () => {
    const { guestCount: _, ...noGuestCount } = validEnquiry;
    expect(EnquirySchema.safeParse(noGuestCount).success).toBe(false);
  });

  it("rejects missing status", () => {
    const { status: _, ...noStatus } = validEnquiry;
    expect(EnquirySchema.safeParse(noStatus).success).toBe(false);
  });

  it("rejects missing respondedBy (required but nullable)", () => {
    const { respondedBy: _, ...noRespondedBy } = validEnquiry;
    expect(EnquirySchema.safeParse(noRespondedBy).success).toBe(false);
  });

  it("rejects missing respondedAt (required but nullable)", () => {
    const { respondedAt: _, ...noRespondedAt } = validEnquiry;
    expect(EnquirySchema.safeParse(noRespondedAt).success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const { createdAt: _, ...noCreatedAt } = validEnquiry;
    expect(EnquirySchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing updatedAt", () => {
    const { updatedAt: _, ...noUpdatedAt } = validEnquiry;
    expect(EnquirySchema.safeParse(noUpdatedAt).success).toBe(false);
  });

  // --- Invalid field values ---

  it("rejects invalid email", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, email: "not-email" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, status: "pending" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, name: "" }).success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, name: "   " }).success).toBe(false);
  });

  it("rejects empty message", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "" }).success).toBe(false);
  });

  it("rejects whitespace-only message", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "   " }).success).toBe(false);
  });

  it("rejects message exceeding 5000 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "A".repeat(5001) }).success).toBe(false);
  });

  it("accepts message of exactly 5000 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "A".repeat(5000) }).success).toBe(true);
  });

  it("rejects phone exceeding 50 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, phone: "1".repeat(51) }).success).toBe(false);
  });

  it("rejects zero guest count", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: 0 }).success).toBe(false);
  });

  it("rejects negative guest count", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: -5 }).success).toBe(false);
  });

  it("rejects float guest count", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: 10.5 }).success).toBe(false);
  });

  it("accepts guest count of 1 (minimum)", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: 1 }).success).toBe(true);
  });

  it("accepts guest count of 10000 (maximum)", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: 10000 }).success).toBe(true);
  });

  it("rejects guest count exceeding 10000", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestCount: 10001 }).success).toBe(false);
  });

  it("rejects invalid datetime for eventDate", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, eventDate: "nope" }).success).toBe(false);
  });

  it("rejects invalid UUID for respondedBy", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, respondedBy: "bad" }).success).toBe(false);
  });

  it("rejects invalid datetime for respondedAt", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, respondedAt: "bad" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateEnquirySchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateEnquirySchema", () => {
  it("accepts a valid create enquiry payload", () => {
    expect(CreateEnquirySchema.safeParse(validCreateEnquiry).success).toBe(true);
  });

  it("defaults phone to empty string when omitted", () => {
    const result = CreateEnquirySchema.safeParse(validCreateEnquiry);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("");
    }
  });

  it("rejects missing venueId", () => {
    const { venueId: _, ...noVenueId } = validCreateEnquiry;
    expect(CreateEnquirySchema.safeParse(noVenueId).success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...noName } = validCreateEnquiry;
    expect(CreateEnquirySchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email: _, ...noEmail } = validCreateEnquiry;
    expect(CreateEnquirySchema.safeParse(noEmail).success).toBe(false);
  });

  it("rejects missing message", () => {
    const { message: _, ...noMessage } = validCreateEnquiry;
    expect(CreateEnquirySchema.safeParse(noMessage).success).toBe(false);
  });

  it("rejects missing guestCount", () => {
    const { guestCount: _, ...noGuestCount } = validCreateEnquiry;
    expect(CreateEnquirySchema.safeParse(noGuestCount).success).toBe(false);
  });

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateEnquirySchema.safeParse({ ...validCreateEnquiry, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept status field (strips extra keys)", () => {
    const result = CreateEnquirySchema.safeParse({ ...validCreateEnquiry, status: "submitted" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("status" in result.data).toBe(false);
    }
  });
});
