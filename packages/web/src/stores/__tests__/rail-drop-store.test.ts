import { beforeEach, describe, expect, it } from "vitest";
import {
  RAIL_DROP_MARGIN_PX,
  RAIL_RETURN_REACH_PX,
  isNearRail,
  isOverRail,
  useRailDropStore,
} from "../rail-drop-store.js";

// ---------------------------------------------------------------------------
// The rail as a drop target (T-671 C0; card-dock spec §3 and §8.1, Q-15): the
// rail publishes where it stands; a piece being moved asks whether it is near
// enough to make the rail the return target (96 px) and whether a release
// would land on it (the rail, plus 16 px once it has lifted).
// ---------------------------------------------------------------------------

const RAIL = { left: 266, top: 869, right: 1334, bottom: 921 };

beforeEach(() => {
  useRailDropStore.getState().reset();
});

describe("where the rail stands", () => {
  it("knows nothing until the rail publishes its rect, and forgets it when the rail goes", () => {
    expect(isOverRail(800, 890)).toBe(false);
    expect(isNearRail(800, 890)).toBe(false);
    useRailDropStore.getState().setRect(RAIL);
    expect(isOverRail(800, 890)).toBe(true);
    useRailDropStore.getState().setRect(null);
    expect(isOverRail(800, 890)).toBe(false);
  });
});

describe("near enough to become the return target", () => {
  it("is near within 96 px of the rail, and not beyond", () => {
    useRailDropStore.getState().setRect(RAIL);
    expect(RAIL_RETURN_REACH_PX).toBe(96);
    expect(isNearRail(800, RAIL.top - 96)).toBe(true);
    expect(isNearRail(800, RAIL.top - 97)).toBe(false);
    // A move ending 100 px above the rail is an ordinary move.
    expect(isNearRail(800, RAIL.top - 100)).toBe(false);
    expect(isNearRail(RAIL.left - 50, RAIL.top - 50)).toBe(true);
    expect(isNearRail(RAIL.left - 80, RAIL.top - 80)).toBe(false);
  });
});

describe("a release that lands on the rail", () => {
  it("counts the rail itself, and 16 px more only once it has lifted as the return target", () => {
    useRailDropStore.getState().setRect(RAIL);
    expect(isOverRail(800, RAIL.top - 10)).toBe(false);
    useRailDropStore.getState().setTarget("return");
    expect(RAIL_DROP_MARGIN_PX).toBe(16);
    expect(isOverRail(800, RAIL.top - 10)).toBe(true);
    expect(isOverRail(800, RAIL.top - 17)).toBe(false);
    useRailDropStore.getState().setTarget("none");
    expect(isOverRail(800, RAIL.top - 10)).toBe(false);
  });

  it("holds one target at a time", () => {
    useRailDropStore.getState().setTarget("replace");
    expect(useRailDropStore.getState().target).toBe("replace");
    useRailDropStore.getState().setTarget("return");
    expect(useRailDropStore.getState().target).toBe("return");
  });
});
