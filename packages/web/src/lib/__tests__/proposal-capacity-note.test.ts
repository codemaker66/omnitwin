import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim, LAYOUT_STYLES } from "@omnitwin/types";
import {
  buildCapacityGuidance,
  buildProposalCapacityGuidance,
  buildProposalCapacityNote,
  CAPACITY_GUIDANCE_DISCLOSURE,
  CAPACITY_STYLE_LABELS,
} from "../proposal-capacity-note.js";

// Grand Hall bounding box: 21m × 10m = 210 m².
const GRAND_HALL_AREA = 210;

describe("buildProposalCapacityGuidance", () => {
  it("computes planning-grade comfortable capacity from floor area", () => {
    const intel = buildProposalCapacityGuidance(GRAND_HALL_AREA, 120, "dinner-rounds");
    expect(intel.comfortableCapacity).toBe(140); // 210 / 1.5 m² per guest
    expect(intel.tightCapacity).toBe(190); // floor(210 / 1.1)
    expect(intel.plannedSeats).toBe(120);
    expect(intel.band).toBe("comfortable"); // 1.75 m²/guest ≥ 1.5
  });

  it("handles zero area and zero guests without claiming anything", () => {
    const empty = buildProposalCapacityGuidance(0, 0, "theatre");
    expect(empty.comfortableCapacity).toBe(0);
    expect(empty.band).toBe("open");
  });
});

describe("buildProposalCapacityNote", () => {
  it("names the room, the estimate, the style, and the human-review disclosure", () => {
    const intel = buildProposalCapacityGuidance(GRAND_HALL_AREA, 120, "dinner-rounds");
    const note = buildProposalCapacityNote("Grand Hall", intel);
    expect(note).toContain("Grand Hall: comfortable for around 140 guests");
    expect(note).toContain("seated dinner on round tables");
    expect(note).toContain("for 120 guests");
    expect(note).toContain("Planning estimate only; human review required");
    expect(note).toContain("final capacity confirmed by the venue team");
  });

  it("omits the fit segment when no guest count is given", () => {
    const intel = buildProposalCapacityGuidance(GRAND_HALL_AREA, 0, "cocktail");
    const note = buildProposalCapacityNote("Saloon", intel);
    expect(note).not.toContain("for 0 guests");
    expect(note).toContain("standing reception");
  });

  it("passes the proposal claim guard for every layout style", () => {
    for (const style of LAYOUT_STYLES) {
      for (const guests of [0, 120]) {
        const intel = buildProposalCapacityGuidance(GRAND_HALL_AREA, guests, style);
        const note = buildProposalCapacityNote("Robert Adam Room", intel);
        expect(findUnsupportedProposalClaim(note)).toBeNull();
      }
    }
  });

  it("stays inside the 500-character payload limit with long room names", () => {
    const intel = buildProposalCapacityGuidance(GRAND_HALL_AREA, 9999, "dinner-banquet");
    const note = buildProposalCapacityNote("The Right Honourable Lady Convenor's Reception Room and North Gallery", intel);
    expect(note.length).toBeLessThanOrEqual(500);
  });

  it("labels every layout style", () => {
    for (const style of LAYOUT_STYLES) {
      expect(CAPACITY_STYLE_LABELS[style].length).toBeGreaterThan(0);
    }
  });
});

describe("buildCapacityGuidance — shared public/client surface guidance (T-429)", () => {
  it("produces a comfortable summary and the standing SAFE disclosure", () => {
    const guidance = buildCapacityGuidance(GRAND_HALL_AREA, 120, "dinner-rounds");
    expect(guidance.intel.comfortableCapacity).toBe(140);
    expect(guidance.styleLabel).toBe("seated dinner on round tables");
    expect(guidance.summary).toBe("around 140 guests as seated dinner on round tables");
    expect(guidance.disclosure).toBe(CAPACITY_GUIDANCE_DISCLOSURE);
  });

  it("includes a comfort-band fit phrase only when a guest count is given", () => {
    const withGuests = buildCapacityGuidance(GRAND_HALL_AREA, 120, "dinner-rounds");
    expect(withGuests.fit).toContain("Comfortable");

    const noGuests = buildCapacityGuidance(GRAND_HALL_AREA, 0, "dinner-rounds");
    expect(noGuests.fit).toBeNull();
  });

  it("reflects an over-capacity request with a review (non-legal) fit phrase", () => {
    const guidance = buildCapacityGuidance(GRAND_HALL_AREA, 900, "dinner-rounds");
    expect(guidance.fit).toContain("review");
    expect(guidance.fit).not.toBeNull();
  });

  it("is claim-guard safe for every layout style and guest count", () => {
    for (const style of LAYOUT_STYLES) {
      for (const guests of [0, 120, 900]) {
        const guidance = buildCapacityGuidance(GRAND_HALL_AREA, guests, style);
        const rendered = `${guidance.summary} ${guidance.fit ?? ""} ${guidance.disclosure}`;
        expect(findUnsupportedProposalClaim(rendered)).toBeNull();
      }
    }
  });

  it("the disclosure carries no certainty claim and names the planning-estimate posture", () => {
    expect(findUnsupportedProposalClaim(CAPACITY_GUIDANCE_DISCLOSURE)).toBeNull();
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("Planning estimate");
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("human review required");
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("final capacity confirmed by the venue team");
  });
});
