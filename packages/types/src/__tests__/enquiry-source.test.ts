import { describe, it, expect } from "vitest";
import {
  ENQUIRY_SOURCES,
  EnquirySourceSchema,
  GuestEnquirySchema,
  TWIN_ENQUIRY_SOURCE_NOTE,
  enquiryReference,
  enquirySourceNote,
  resolveEnquirySource,
} from "../enquiry.js";
import { findUnsupportedProposalClaim } from "../proposal.js";

// ---------------------------------------------------------------------------
// Enquiry source — which front door the guest came through.
//
// Before this existed the public route inferred the source from the anchor:
// a configurationId meant the planner, a venueSlug meant the twin. That
// inference is now wrong, because the marketing homepage also anchors by
// venueSlug — so without an explicit discriminator every homepage enquiry
// would be stamped with the twin's walkthrough note and the events team would
// be told the wrong thing about where their lead came from.
//
// The xor anchor rule is unchanged and still security-load-bearing; `source`
// is descriptive only and must never widen which venues can be enquired at.
// ---------------------------------------------------------------------------

const CONFIG_UUID = "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80";

describe("EnquirySourceSchema", () => {
  it("names exactly the three front doors that exist", () => {
    expect([...ENQUIRY_SOURCES]).toEqual(["planner", "twin", "homepage"]);
  });

  it("rejects a source that is not a real front door", () => {
    expect(EnquirySourceSchema.safeParse("carrier-pigeon").success).toBe(false);
  });
});

describe("GuestEnquirySchema with a source", () => {
  it("accepts an explicit homepage source alongside a venue slug", () => {
    const parsed = GuestEnquirySchema.safeParse({
      venueSlug: "trades-hall",
      email: "guest@example.com",
      source: "homepage",
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts payloads with no source, so existing clients keep working", () => {
    const parsed = GuestEnquirySchema.safeParse({
      configurationId: CONFIG_UUID,
      email: "guest@example.com",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown source rather than silently ignoring it", () => {
    const parsed = GuestEnquirySchema.safeParse({
      venueSlug: "trades-hall",
      email: "guest@example.com",
      source: "not-a-door",
    });
    expect(parsed.success).toBe(false);
  });

  it("does not let a source substitute for an anchor", () => {
    // `source` is descriptive. It must not satisfy the configurationId/venueSlug
    // xor, or a caller could reach the route with no venue at all.
    const parsed = GuestEnquirySchema.safeParse({
      email: "guest@example.com",
      source: "homepage",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("resolveEnquirySource", () => {
  it("honours an explicit source over what the anchor would imply", () => {
    expect(
      resolveEnquirySource({ venueSlug: "trades-hall", source: "homepage" }),
    ).toBe("homepage");
  });

  it("still reads a bare venue slug as the twin, preserving today's behaviour", () => {
    // Regression guard: the deployed TwinEnquiryModal sends no source. If this
    // ever flips, live twin enquiries start being mislabelled.
    expect(resolveEnquirySource({ venueSlug: "trades-hall" })).toBe("twin");
  });

  it("reads a bare configuration anchor as the planner", () => {
    expect(resolveEnquirySource({ configurationId: CONFIG_UUID })).toBe("planner");
  });
});

describe("enquirySourceNote", () => {
  it("keeps the twin's note byte-for-byte, so historic enquiries stay comparable", () => {
    expect(enquirySourceNote("twin")).toBe(TWIN_ENQUIRY_SOURCE_NOTE);
    expect(TWIN_ENQUIRY_SOURCE_NOTE).toBe(
      "Sent from the venue's virtual walkthrough (the twin).",
    );
  });

  it("gives the homepage its own note, never the twin's", () => {
    const note = enquirySourceNote("homepage");
    expect(note).not.toBeNull();
    expect(note).not.toBe(TWIN_ENQUIRY_SOURCE_NOTE);
  });

  it("adds no note for the planner, whose context is the configuration itself", () => {
    expect(enquirySourceNote("planner")).toBeNull();
  });

  it("writes every note in claim-safe language", () => {
    for (const source of ENQUIRY_SOURCES) {
      const note = enquirySourceNote(source);
      if (note === null) continue;
      expect(findUnsupportedProposalClaim(note), `claim guard tripped on: ${note}`).toBeNull();
    }
  });

  it("promises nothing about availability, which no source can know", () => {
    for (const source of ENQUIRY_SOURCES) {
      const note = enquirySourceNote(source);
      if (note === null) continue;
      expect(note.toLowerCase()).not.toContain("available");
      expect(note.toLowerCase()).not.toContain("your date is");
    }
  });
});

// ---------------------------------------------------------------------------
// enquiryReference — the short human handle for an enquiry.
//
// The acknowledgement email and the homepage's success state must show the
// SAME string, or a client quoting their reference on the phone won't match
// what the events team can find. Deriving it in one shared place is what
// makes that guarantee hold; two independent derivations would drift.
// ---------------------------------------------------------------------------

describe("enquiryReference", () => {
  const ENQUIRY_UUID = "3f9a2b1c-d4e5-4f6a-8b9c-0d1e2f3a4b5c";

  it("is short enough to read down a phone line", () => {
    expect(enquiryReference(ENQUIRY_UUID)).toHaveLength(8);
  });

  it("is stable for the same enquiry", () => {
    expect(enquiryReference(ENQUIRY_UUID)).toBe(enquiryReference(ENQUIRY_UUID));
  });

  it("differs between enquiries", () => {
    expect(enquiryReference(ENQUIRY_UUID)).not.toBe(
      enquiryReference("9c8b7a6d-5e4f-4a3b-9c8d-7e6f5a4b3c2d"),
    );
  });

  it("upper-cases so it survives being written down", () => {
    const reference = enquiryReference(ENQUIRY_UUID);
    expect(reference).toBe(reference.toUpperCase());
  });

  it("stays a findable prefix of the enquiry id", () => {
    // The events team's only lookup path is the id. If the reference stopped
    // being its leading hex, a quoted reference would be untraceable.
    expect(ENQUIRY_UUID.replace(/-/g, "").toUpperCase().startsWith(enquiryReference(ENQUIRY_UUID))).toBe(true);
  });
});
