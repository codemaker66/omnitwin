import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim, LAYOUT_STYLES } from "@omnitwin/types";
import {
  buildProposalCapacityGuidance,
  buildProposalCapacityNote,
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
    expect(note).toContain("Planning estimate only, human review required");
    expect(note).toContain("not a legal occupancy or fire-capacity figure");
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
