import { describe, expect, it } from "vitest";
import type { ProposalFacts, ProposalLayoutItem, ProposalLayoutSnapshot } from "@omnitwin/types";
import { layoutChange, nextVersionBasis } from "../services/proposal-taken.js";

// The composer's check compares the drawing a version saved now would take
// with the one its client's page shows, as that page shows it: an untouched
// layout read twice is the same drawing, whatever order its pieces come back
// in; a piece moved by a millimetre, turned, added or taken away is not.

const table: ProposalLayoutItem = { shape: "round", kind: "table", xM: 4, zM: 3, widthM: 1.8, depthM: 1.8, rotationDeg: 0 };
const chair: ProposalLayoutItem = { shape: "rect", kind: "chair", xM: 4, zM: 4.2, widthM: 0.45, depthM: 0.45, rotationDeg: 180 };
const stage: ProposalLayoutItem = { shape: "rect", kind: "stage", xM: 10, zM: 1, widthM: 6, depthM: 2.4, rotationDeg: 0 };
const drawing: ProposalLayoutSnapshot = { roomWidthM: 20, roomLengthM: 12, items: [table, chair, stage] };

function drawn(items: readonly ProposalLayoutItem[], room: Partial<ProposalLayoutSnapshot> = {}): ProposalLayoutSnapshot {
  return { roomWidthM: 20, roomLengthM: 12, ...room, items: [...items] };
}

describe("layoutChange", () => {
  it("reads an untouched drawing as the same, in any order and through float noise", () => {
    expect(layoutChange(drawing, drawn([stage, table, chair]))).toBe("same");
    expect(layoutChange(drawing, drawn([
      { ...table, xM: 4 + 1e-9 }, { ...chair, zM: 4.2 - 1e-9 }, { ...stage, widthM: 6.0000001 },
    ]))).toBe("same");
    // Minus zero, and a fraction of a millimetre, are the same position.
    expect(layoutChange(drawn([{ ...stage, zM: 0 }]), drawn([{ ...stage, zM: -0 }]))).toBe("same");
    expect(layoutChange(drawn([{ ...stage, zM: 0 }]), drawn([{ ...stage, zM: 0.0003 }]))).toBe("same");
  });

  it("reads a whole turn as no turn, either way round", () => {
    expect(layoutChange(drawn([chair]), drawn([{ ...chair, rotationDeg: 540 }]))).toBe("same");
    expect(layoutChange(drawn([chair]), drawn([{ ...chair, rotationDeg: -180 }]))).toBe("same");
    expect(layoutChange(drawn([stage]), drawn([{ ...stage, rotationDeg: 359.99 }]))).toBe("same");
  });

  it("sees a piece moved by a millimetre, turned, added, taken away or duplicated", () => {
    expect(layoutChange(drawing, drawn([{ ...table, xM: 4.001 }, chair, stage]))).toBe("changed");
    expect(layoutChange(drawing, drawn([table, { ...chair, rotationDeg: 90 }, stage]))).toBe("changed");
    expect(layoutChange(drawing, drawn([table, chair, stage, { ...table, xM: 8 }]))).toBe("changed");
    expect(layoutChange(drawing, drawn([table, stage]))).toBe("changed");
    expect(layoutChange(drawing, drawn([table, chair, chair, stage]))).toBe("changed");
    expect(layoutChange(drawing, drawn([table, chair, { ...stage, kind: "other" }]))).toBe("changed");
  });

  it("sees the room drawn at another size", () => {
    expect(layoutChange(drawing, drawn([table, chair, stage], { roomLengthM: 12.5 }))).toBe("changed");
  });

  it("says a drawing is added, removed or absent on both sides", () => {
    expect(layoutChange(null, drawing)).toBe("added");
    expect(layoutChange(undefined, drawing)).toBe("added");
    expect(layoutChange(drawing, null)).toBe("removed");
    expect(layoutChange(null, undefined)).toBe("none");
  });

  it("takes a drawing with nothing in it for no drawing, as the client's page does", () => {
    expect(layoutChange(drawn([]), drawing)).toBe("added");
    expect(layoutChange(drawing, drawn([]))).toBe("removed");
    expect(layoutChange(drawn([]), null)).toBe("none");
  });
});

describe("nextVersionBasis", () => {
  const facts: ProposalFacts = { eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" };
  const links = { venueId: "v", opportunityId: "d", enquiryId: "e", configurationId: "c" };
  const basis = nextVersionBasis(2, links, { layoutSnapshot: drawing, facts });

  it("names what was checked the same way each time, whatever order the pieces came in", () => {
    expect(basis).toMatch(/^[0-9a-f]{64}$/u);
    expect(nextVersionBasis(2, links, { layoutSnapshot: drawn([stage, chair, table]), facts: { ...facts } })).toBe(basis);
  });

  it("changes with the version, the links, the drawing and each fact", () => {
    const others = [
      nextVersionBasis(3, links, { layoutSnapshot: drawing, facts }),
      nextVersionBasis(2, { ...links, configurationId: "c2" }, { layoutSnapshot: drawing, facts }),
      nextVersionBasis(2, { ...links, opportunityId: null }, { layoutSnapshot: drawing, facts }),
      nextVersionBasis(2, { ...links, enquiryId: "e2" }, { layoutSnapshot: drawing, facts }),
      nextVersionBasis(2, links, { layoutSnapshot: drawn([table, chair]), facts }),
      nextVersionBasis(2, links, { layoutSnapshot: null, facts }),
      nextVersionBasis(2, links, { facts }),
      nextVersionBasis(2, links, { layoutSnapshot: drawing, facts: { ...facts, eventDate: "2027-06-12" } }),
      nextVersionBasis(2, links, { layoutSnapshot: drawing, facts: { ...facts, guestCount: 180 } }),
      nextVersionBasis(2, links, { layoutSnapshot: drawing, facts: { ...facts, occasion: "dinner" } }),
      nextVersionBasis(2, links, { layoutSnapshot: drawing, facts: { ...facts, roomName: "Saloon" } }),
      nextVersionBasis(2, links, { layoutSnapshot: drawing, facts: { ...facts, roomSlug: "grand-hall-2" } }),
    ];
    for (const other of others) expect(other).not.toBe(basis);
    // A drawing with nothing in it is no drawing, with a layout linked or not.
    expect(nextVersionBasis(2, links, { layoutSnapshot: drawn([]), facts }))
      .toBe(nextVersionBasis(2, links, { layoutSnapshot: null, facts }));
  });
});
