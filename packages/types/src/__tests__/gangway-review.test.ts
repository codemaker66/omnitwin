import { describe, expect, it } from "vitest";
import {
  GANGWAY_DECISION_MOVE_M,
  GANGWAY_DECISION_TOLERANCE_M,
  GangwayReviewItemSchema,
  GangwayReviewSchema,
  SCOTTISH_GANGWAY_GUIDANCE,
  gangwayLocationCentre,
  gangwayReviewId,
  withGangwayDecisions,
  type GangwayReviewItem,
} from "../gangway-review.js";

function item(overrides: Partial<GangwayReviewItem> = {}): GangwayReviewItem {
  return {
    id: "gangway:zMin:g-4+wall:zMin",
    widthM: 0.95,
    guidance: SCOTTISH_GANGWAY_GUIDANCE,
    gangway: "the window wall",
    location: { kind: "segment", from: { x: -4.5, z: -5.25 }, to: { x: -4.5, z: -4.3 } },
    pieceIds: ["chair-1"],
    sides: ["the window wall", "Table 4's chairs"],
    status: "open",
    ...overrides,
  };
}

describe("the gangway review item", () => {
  it("parses an open item and a decided one", () => {
    expect(GangwayReviewItemSchema.parse(item())).toEqual(item());
    const decided = item({ status: "approved", reviewer: "The hallkeeper", decisionNote: "Chairs tucked in on the day", decidedAt: "2026-10-26T09:30:00.000Z" });
    expect(GangwayReviewItemSchema.parse(decided)).toEqual(decided);
    expect(GangwayReviewSchema.parse({ items: [item(), decided] }).items).toHaveLength(2);
  });

  it("takes a polygon for where a pinch is", () => {
    const polygon = item({ location: { kind: "polygon", points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] } });
    expect(GangwayReviewItemSchema.safeParse(polygon).success).toBe(true);
  });

  it("refuses an unknown status, a negative width and a time that is not an ISO instant", () => {
    expect(GangwayReviewItemSchema.safeParse({ ...item(), status: "maybe" }).success).toBe(false);
    expect(GangwayReviewItemSchema.safeParse(item({ widthM: -0.1 })).success).toBe(false);
    expect(GangwayReviewItemSchema.safeParse(item({ decidedAt: "26 October" })).success).toBe(false);
  });

  it("measures against Scotland's 1.1 m", () => {
    expect(SCOTTISH_GANGWAY_GUIDANCE.thresholdM).toBe(1.1);
    expect(SCOTTISH_GANGWAY_GUIDANCE.source).toMatch(/^Scottish Government/u);
  });
});

describe("the id rule", () => {
  it("is the gangway and what stands either side, sorted, with no position to round", () => {
    expect(gangwayReviewId("zMin", [{ unit: "g-4" }, { wall: "zMin" }])).toBe("gangway:zMin:g-4+wall:zMin");
    expect(gangwayReviewId("zMin", [{ wall: "zMin" }, { unit: "g-4" }])).toBe("gangway:zMin:g-4+wall:zMin");
    expect(gangwayReviewId("spine", [{ unit: "g-9" }, { unit: "g-2" }])).toBe("gangway:spine:g-2+g-9");
  });
});

describe("decisions laid over the derived items", () => {
  const approved = item({ status: "approved", reviewer: "The hallkeeper", decidedAt: "2026-10-26T09:30:00.000Z" });

  it("carry a decision to the same pinch", () => {
    expect(withGangwayDecisions([item({ widthM: 0.93 })], [approved])[0]).toMatchObject({ status: "approved", reviewer: "The hallkeeper", widthM: 0.93 });
  });

  it("reopen a pinch narrowed by more than the tolerance since", () => {
    const narrower = item({ widthM: approved.widthM - GANGWAY_DECISION_TOLERANCE_M - 0.01 });
    const [reopened] = withGangwayDecisions([narrower], [approved]);
    expect(reopened?.status).toBe("open");
    expect(reopened?.reviewer).toBeUndefined();
  });

  it("reopen a pinch widened by more than the tolerance, so a requested adjustment is reviewed once made", () => {
    const denied = item({ status: "denied", widthM: 0.5 });
    expect(withGangwayDecisions([item({ widthM: 0.95 })], [denied])[0]?.status).toBe("open");
    const asked = item({ status: "adjustment-requested", widthM: 0.8 });
    expect(withGangwayDecisions([item({ widthM: 1.0 })], [asked])[0]?.status).toBe("open");
    expect(withGangwayDecisions([item({ widthM: 0.83 })], [asked])[0]?.status).toBe("adjustment-requested");
  });

  it("hold through a nudge across any half metre, and reopen a pinch moved more than a metre", () => {
    // Along a Grand Hall wall a snapped piece sits at x.5 m, where a rounded position would flip.
    const at = (x: number): GangwayReviewItem => item({ location: { kind: "segment", from: { x, z: -5.25 }, to: { x, z: -4.3 } } });
    const decided = { ...at(0.5), status: "approved" as const, reviewer: "The hallkeeper" };
    expect(withGangwayDecisions([at(0.499)], [decided])[0]?.status).toBe("approved");
    expect(withGangwayDecisions([at(0.5 + GANGWAY_DECISION_MOVE_M - 0.01)], [decided])[0]?.status).toBe("approved");
    expect(withGangwayDecisions([at(0.5 + GANGWAY_DECISION_MOVE_M + 0.01)], [decided])[0]?.status).toBe("open");
  });

  it("find the middle of a segment and of a polygon", () => {
    expect(gangwayLocationCentre({ kind: "segment", from: { x: -1, z: 2 }, to: { x: 3, z: 4 } })).toEqual({ x: 1, z: 3 });
    expect(gangwayLocationCentre({ kind: "polygon", points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }] })).toEqual({ x: 2, z: 1 });
  });

  it("drop a decision whose pinch has gone, and ignore stored items still open", () => {
    expect(withGangwayDecisions([], [approved])).toEqual([]);
    expect(withGangwayDecisions([item()], [item({ reviewer: "nobody" })])[0]?.reviewer).toBeUndefined();
  });
});
