import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim, LAYOUT_STYLES, TRADES_HALL_ROOM_CAPACITIES } from "@omnitwin/types";
import {
  buildProposalCapacityGuidance,
  CAPACITY_GUIDANCE_DISCLOSURE,
  CAPACITY_STYLE_LABELS,
} from "../proposal-capacity-note.js";
import { publishedCapacityFor, publishedCapacityNote, publishedFormatForStyle } from "../planner-truth.js";

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

// The proposal composer puts publishedCapacityNote (planner-truth.ts) into the
// client's capacity note, never the estimate above: the note must pass the
// proposal claim guard and fit the 500-character payload field everywhere.
describe("the capacity note the composer puts in the proposal", () => {
  const rooms = [...Object.keys(TRADES_HALL_ROOM_CAPACITIES), "a-room-nobody-published"];

  it("passes the proposal claim guard for every room, layout style and guest count", () => {
    for (const slug of rooms) {
      for (const tradesHall of [true, false]) {
        for (const style of LAYOUT_STYLES) {
          for (const guests of [null, 120, 9999]) {
            const note = publishedCapacityNote({
              published: publishedCapacityFor({ slug, tradesHall }),
              format: publishedFormatForStyle(style),
              roomName: "Robert Adam Room",
              guests,
            });
            expect(findUnsupportedProposalClaim(note)).toBeNull();
          }
        }
      }
    }
  });

  it("stays inside the 500-character payload limit with long room names", () => {
    const note = publishedCapacityNote({
      published: publishedCapacityFor({ slug: "grand-hall", tradesHall: true }),
      format: null,
      roomName: "The Right Honourable Lady Convenor's Reception Room and North Gallery",
      guests: 9999,
    });
    expect(note.length).toBeLessThanOrEqual(500);
  });
});

describe("CAPACITY_STYLE_LABELS", () => {
  it("labels every layout style", () => {
    for (const style of LAYOUT_STYLES) {
      expect(CAPACITY_STYLE_LABELS[style].length).toBeGreaterThan(0);
    }
  });
});

describe("CAPACITY_GUIDANCE_DISCLOSURE", () => {
  it("the disclosure carries no certainty claim and names the planning-estimate posture", () => {
    expect(findUnsupportedProposalClaim(CAPACITY_GUIDANCE_DISCLOSURE)).toBeNull();
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("Planning estimate");
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("human review required");
    expect(CAPACITY_GUIDANCE_DISCLOSURE).toContain("final capacity confirmed by the venue team");
  });
});
