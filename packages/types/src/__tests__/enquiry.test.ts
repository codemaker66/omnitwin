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

// New schema shape: state (not status), guestPhone (not phone),
// preferredDate date-only string, estimatedGuests (not guestCount).
const validEnquiry = {
  id: VALID_UUID,
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  configurationId: VALID_CONFIG_UUID,
  userId: VALID_USER_UUID,
  name: "John Doe",
  email: "john@example.com",
  guestPhone: "+44 7911 123456",
  guestEmail: "john.guest@example.com",
  guestName: "John Doe",
  eventType: "wedding",
  message: "We would like to book the Grand Hall for a wedding.",
  preferredDate: "2025-06-15",
  estimatedGuests: 150,
  state: "submitted" as const,
  createdAt: VALID_DATETIME,
  updatedAt: VALID_DATETIME,
};

const validCreateEnquiry = {
  venueId: VALID_VENUE_UUID,
  spaceId: VALID_SPACE_UUID,
  configurationId: VALID_CONFIG_UUID,
  name: "John Doe",
  email: "john@example.com",
  message: "We would like to book the Grand Hall.",
  preferredDate: "2025-06-15",
  estimatedGuests: 150,
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

  it("has exactly 7 statuses", () => {
    expect(ENQUIRY_STATUSES).toHaveLength(7);
  });

  it("contains the expected statuses in order", () => {
    expect(ENQUIRY_STATUSES).toEqual([
      "draft",
      "submitted",
      "under_review",
      "approved",
      "rejected",
      "withdrawn",
      "archived",
    ]);
  });

  it("rejects 'Submitted' (case sensitive)", () => {
    expect(EnquiryStatusSchema.safeParse("Submitted").success).toBe(false);
  });

  it("rejects 'pending' (not a valid status)", () => {
    expect(EnquiryStatusSchema.safeParse("pending").success).toBe(false);
  });

  it("rejects 'viewed' (old status, removed)", () => {
    expect(EnquiryStatusSchema.safeParse("viewed").success).toBe(false);
  });

  it("rejects 'converted' (old status, removed)", () => {
    expect(EnquiryStatusSchema.safeParse("converted").success).toBe(false);
  });

  it("rejects 'lost' (old status, removed)", () => {
    expect(EnquiryStatusSchema.safeParse("lost").success).toBe(false);
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
  it("defines transitions for all 7 statuses", () => {
    expect(Object.keys(VALID_ENQUIRY_TRANSITIONS)).toHaveLength(7);
  });

  it("draft can only transition to submitted", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.draft).toEqual(["submitted"]);
  });

  it("submitted can transition to under_review or withdrawn", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.submitted).toEqual(["under_review", "withdrawn"]);
  });

  it("under_review can transition to approved, rejected, or withdrawn", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.under_review).toEqual(["approved", "rejected", "withdrawn"]);
  });

  it("approved can transition to archived", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.approved).toEqual(["archived"]);
  });

  it("rejected can transition to archived", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.rejected).toEqual(["archived"]);
  });

  it("withdrawn is terminal (no transitions)", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.withdrawn).toEqual([]);
  });

  it("archived is terminal (no transitions)", () => {
    expect(VALID_ENQUIRY_TRANSITIONS.archived).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidEnquiryTransition
// ---------------------------------------------------------------------------

describe("isValidEnquiryTransition", () => {
  // --- Legal transitions ---
  it("draft → submitted is valid", () => {
    expect(isValidEnquiryTransition("draft", "submitted")).toBe(true);
  });

  it("submitted → under_review is valid", () => {
    expect(isValidEnquiryTransition("submitted", "under_review")).toBe(true);
  });

  it("submitted → withdrawn is valid", () => {
    expect(isValidEnquiryTransition("submitted", "withdrawn")).toBe(true);
  });

  it("under_review → approved is valid", () => {
    expect(isValidEnquiryTransition("under_review", "approved")).toBe(true);
  });

  it("under_review → rejected is valid", () => {
    expect(isValidEnquiryTransition("under_review", "rejected")).toBe(true);
  });

  it("under_review → withdrawn is valid", () => {
    expect(isValidEnquiryTransition("under_review", "withdrawn")).toBe(true);
  });

  it("approved → archived is valid", () => {
    expect(isValidEnquiryTransition("approved", "archived")).toBe(true);
  });

  it("rejected → archived is valid", () => {
    expect(isValidEnquiryTransition("rejected", "archived")).toBe(true);
  });

  // --- Illegal transitions ---
  it("draft → approved is invalid (skips steps)", () => {
    expect(isValidEnquiryTransition("draft", "approved")).toBe(false);
  });

  it("submitted → approved is invalid (must go through under_review)", () => {
    expect(isValidEnquiryTransition("submitted", "approved")).toBe(false);
  });

  it("submitted → submitted is invalid (self-transition)", () => {
    expect(isValidEnquiryTransition("submitted", "submitted")).toBe(false);
  });

  it("under_review → under_review is invalid (self-transition)", () => {
    expect(isValidEnquiryTransition("under_review", "under_review")).toBe(false);
  });

  it("approved → submitted is invalid (backward)", () => {
    expect(isValidEnquiryTransition("approved", "submitted")).toBe(false);
  });

  it("withdrawn → anything is invalid (terminal)", () => {
    const allStatuses: EnquiryStatus[] = [
      "draft", "submitted", "under_review", "approved", "rejected", "withdrawn", "archived",
    ];
    for (const status of allStatuses) {
      expect(isValidEnquiryTransition("withdrawn", status)).toBe(false);
    }
  });

  it("archived → anything is invalid (terminal)", () => {
    const allStatuses: EnquiryStatus[] = [
      "draft", "submitted", "under_review", "approved", "rejected", "withdrawn", "archived",
    ];
    for (const status of allStatuses) {
      expect(isValidEnquiryTransition("archived", status)).toBe(false);
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
      expect(result.data.state).toBe("submitted");
      expect(result.data.estimatedGuests).toBe(150);
    }
  });

  it("accepts null configurationId", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, configurationId: null }).success).toBe(true);
  });

  it("accepts null userId", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, userId: null }).success).toBe(true);
  });

  it("accepts null guestPhone", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestPhone: null }).success).toBe(true);
  });

  it("accepts null guestEmail", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestEmail: null }).success).toBe(true);
  });

  it("accepts null guestName", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestName: null }).success).toBe(true);
  });

  it("accepts null eventType", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, eventType: null }).success).toBe(true);
  });

  it("accepts null preferredDate", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, preferredDate: null }).success).toBe(true);
  });

  it("accepts null estimatedGuests", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: null }).success).toBe(true);
  });

  it("accepts null message", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: null }).success).toBe(true);
  });

  it("trims whitespace from name", () => {
    const result = EnquirySchema.safeParse({ ...validEnquiry, name: "  John Doe  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("John Doe");
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

  it("rejects missing name", () => {
    const { name: _, ...noName } = validEnquiry;
    expect(EnquirySchema.safeParse(noName).success).toBe(false);
  });

  it("rejects missing email", () => {
    const { email: _, ...noEmail } = validEnquiry;
    expect(EnquirySchema.safeParse(noEmail).success).toBe(false);
  });

  it("rejects missing state", () => {
    const { state: _, ...noState } = validEnquiry;
    expect(EnquirySchema.safeParse(noState).success).toBe(false);
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

  it("rejects invalid state", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, state: "pending" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, name: "" }).success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, name: "   " }).success).toBe(false);
  });

  it("rejects message exceeding 2000 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "A".repeat(2001) }).success).toBe(false);
  });

  it("accepts message of exactly 2000 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, message: "A".repeat(2000) }).success).toBe(true);
  });

  it("rejects guestPhone exceeding 30 characters", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, guestPhone: "1".repeat(31) }).success).toBe(false);
  });

  it("rejects negative estimatedGuests", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: -5 }).success).toBe(false);
  });

  it("rejects float estimatedGuests", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: 10.5 }).success).toBe(false);
  });

  it("accepts estimatedGuests of 0", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: 0 }).success).toBe(true);
  });

  it("accepts estimatedGuests of 10000 (maximum)", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: 10000 }).success).toBe(true);
  });

  it("rejects estimatedGuests exceeding 10000", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, estimatedGuests: 10001 }).success).toBe(false);
  });

  it("rejects preferredDate that is not YYYY-MM-DD format", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, preferredDate: "15/06/2025" }).success).toBe(false);
  });

  it("rejects preferredDate that is a datetime string", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, preferredDate: "2025-06-15T14:00:00.000Z" }).success).toBe(false);
  });

  it("accepts preferredDate in YYYY-MM-DD format", () => {
    expect(EnquirySchema.safeParse({ ...validEnquiry, preferredDate: "2026-12-31" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CreateEnquirySchema — creation payload
// ---------------------------------------------------------------------------

describe("CreateEnquirySchema", () => {
  it("accepts a valid create enquiry payload", () => {
    expect(CreateEnquirySchema.safeParse(validCreateEnquiry).success).toBe(true);
  });

  it("accepts optional fields omitted", () => {
    const minimal = {
      venueId: VALID_VENUE_UUID,
      spaceId: VALID_SPACE_UUID,
      configurationId: VALID_CONFIG_UUID,
      name: "Jane Doe",
      email: "jane@example.com",
    };
    expect(CreateEnquirySchema.safeParse(minimal).success).toBe(true);
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

  it("does not accept id field (strips extra keys)", () => {
    const result = CreateEnquirySchema.safeParse({ ...validCreateEnquiry, id: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("id" in result.data).toBe(false);
    }
  });

  it("does not accept state field (strips extra keys)", () => {
    const result = CreateEnquirySchema.safeParse({ ...validCreateEnquiry, state: "submitted" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("state" in result.data).toBe(false);
    }
  });
});
