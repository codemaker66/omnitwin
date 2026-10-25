import { describe, expect, it } from "vitest";
import {
  GANGWAY_DECISION_TOLERANCE_M,
  GangwayReviewItemSchema,
  GangwayReviewSchema,
  SCOTTISH_GANGWAY_GUIDANCE,
  gangwayReviewId,
  withGangwayDecisions,
  type GangwayReviewItem,
} from "../gangway-review.js";

function item(overrides: Partial<GangwayReviewItem> = {}): GangwayReviewItem {
  return {
    id: "gangway:zMin:6:g-4+wall:zMin",
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
  it("is the gangway, the whole metre along it and what stands either side, sorted", () => {
    expect(gangwayReviewId("zMin", 6.4, [{ unit: "g-4" }, { wall: "zMin" }])).toBe("gangway:zMin:6:g-4+wall:zMin");
    expect(gangwayReviewId("zMin", 6.6, [{ wall: "zMin" }, { unit: "g-4" }])).toBe("gangway:zMin:7:g-4+wall:zMin");
    expect(gangwayReviewId("spine", 10.2, [{ unit: "g-9" }, { unit: "g-2" }])).toBe("gangway:spine:10:g-2+g-9");
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

  it("drop a decision whose pinch has gone, and ignore stored items still open", () => {
    expect(withGangwayDecisions([], [approved])).toEqual([]);
    expect(withGangwayDecisions([item()], [item({ reviewer: "nobody" })])[0]?.reviewer).toBeUndefined();
  });
});
