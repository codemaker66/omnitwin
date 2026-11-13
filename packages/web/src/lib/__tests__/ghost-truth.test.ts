import { describe, expect, it } from "vitest";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  atVerdict,
  createGhostWorld,
  ghostTagWords,
  judgeGhost,
  refusalChip,
  refusalChipVisible,
  refusalSubLine,
} from "../ghost-truth.js";
import { createPlacedItem, type PlacedItem } from "../placement.js";
import { cardParamsFor, stampSetup } from "../setup-cards.js";

const lecternItem = getCatalogueItemBySlug("lectern");
if (lecternItem === undefined) throw new Error("lectern fixture missing");
const LECTERN = lecternItem;

function lectern(x: number, z: number, id = "lectern"): PlacedItem {
  return createPlacedItem(LECTERN.id, x, z, 0, null, 0, id);
}

function world(placed: readonly PlacedItem[]): ReturnType<typeof createGhostWorld> {
  return createGhostWorld(placed, GRAND_HALL_RENDER_DIMENSIONS);
}

let counter = 0;
function ids(): string {
  counter += 1;
  return `stamp-${String(counter)}`;
}

function round(x: number, z: number, label?: string): readonly PlacedItem[] {
  const params = cardParamsFor("round");
  if (params === null) throw new Error("no round");
  const stamp = stampSetup(params, { x, z }, 0, ids);
  return label === undefined ? stamp : stamp.map((piece, i) => (i === 0 ? { ...piece, label } : piece));
}

describe("a ghost in the open", () => {
  it("fits", () => {
    const verdict = judgeGhost([lectern(5, 0, "ghost")], world([]));
    expect(verdict).toMatchObject({ state: "fits", dx: 0, dz: 0, obstacle: null });
    expect(ghostTagWords(verdict)).toBe("fits");
  });
});

describe("the forgiving push", () => {
  it("pushes a 0.12 m overlap clear and sets it down there", () => {
    const ghost = [lectern(0.48, 0, "ghost")];
    const verdict = judgeGhost(ghost, world([lectern(0, 0)]));
    expect(verdict.state).toBe("pushed");
    expect(verdict.dx).toBeCloseTo(0.12, 5);
    expect(verdict.dz).toBe(0);
    expect(verdict.pushedM).toBeCloseTo(0.12, 5);
    expect(ghostTagWords(verdict)).toBe("fits · moved 0.12 m");
    expect(atVerdict(ghost, verdict)[0]?.x).toBeCloseTo(0.6, 5);
  });

  it("refuses a 0.16 m overlap, naming what is in the way and how far", () => {
    const verdict = judgeGhost([lectern(0.44, 0, "ghost")], world([lectern(0, 0)]));
    expect(verdict.state).toBe("refused");
    expect(verdict.obstacle).toMatchObject({ kind: "overlap", obstacleId: "lectern", obstacleLabel: "the lectern" });
    expect(verdict.obstacle?.depthM).toBeCloseTo(0.16, 5);
    expect(verdict.blockingIds).toEqual(["lectern"]);
    expect(ghostTagWords(verdict)).toBe("won't fit");
    expect(refusalChip(verdict.obstacle)).toBe("Won't fit · would overlap the lectern by 0.2 m");
    expect(atVerdict([lectern(0.44, 0, "ghost")], verdict)[0]?.x).toBe(0.44);
  });

  it("pushes a piece 0.1 m through the wall back in", () => {
    const halfRoom = GRAND_HALL_RENDER_DIMENSIONS.width / 2;
    const verdict = judgeGhost([lectern(halfRoom - 0.3 + 0.1, 0, "ghost")], world([]));
    expect(verdict.state).toBe("pushed");
    expect(verdict.dx).toBeCloseTo(-0.1, 5);
  });

  it("refuses a piece 0.3 m through the wall", () => {
    const verdict = judgeGhost([lectern(GRAND_HALL_RENDER_DIMENSIONS.width / 2, 0, "ghost")], world([]));
    expect(verdict.state).toBe("refused");
    expect(refusalChip(verdict.obstacle)).toBe("Won't fit · 0.3 m through the wall");
  });
});

describe("hysteresis", () => {
  it("asks a refused ghost to clear by 0.02 m before it fits again, and never pushes one that fits", () => {
    const room = world([lectern(0, 0)]);
    const nearlyClear = [lectern(0.61, 0, "ghost")];
    expect(judgeGhost(nearlyClear, room, { previous: "fits" }).state).toBe("fits");
    const held = judgeGhost(nearlyClear, room, { previous: "refused" });
    expect(held).toMatchObject({ state: "refused", dx: 0, dz: 0 });
    expect(held.obstacle?.obstacleLabel).toBe("the lectern");
    expect(judgeGhost([lectern(0.63, 0, "ghost")], room, { previous: "refused" }).state).toBe("fits");
  });

  it("lets a refused ghost be pushed again only 0.02 m inside the limit", () => {
    const room = world([lectern(0, 0)]);
    const deep = [lectern(0.46, 0, "ghost")];
    expect(judgeGhost(deep, room, { previous: "fits" }).state).toBe("pushed");
    expect(judgeGhost(deep, room, { previous: "refused" }).state).toBe("refused");
    const shallow = judgeGhost([lectern(0.48, 0, "ghost")], room, { previous: "refused" });
    expect(shallow.state).toBe("pushed");
    expect(shallow.dx).toBeCloseTo(0.12, 5);
  });
});

describe("a push that meets a second piece", () => {
  it("finds the shift past both, though neither escape alone clears", () => {
    // Lecterns are 0.6 × 0.5 m: one on the left overlaps the ghost by 0.05 m;
    // a step right runs into a second, up and to the right.
    const room = world([lectern(-0.55, 0, "left"), lectern(0.63, 0.45, "diagonal")]);
    const verdict = judgeGhost([lectern(0, 0, "ghost")], room);
    expect(verdict.state).toBe("pushed");
    expect(verdict.pushedM).toBeLessThanOrEqual(0.15);
    const landed = atVerdict([lectern(0, 0, "ghost")], verdict);
    expect(judgeGhost(landed, room).state).toBe("fits");
  });
});

describe("the whole set", () => {
  it("is judged chair by chair, not by its table alone", () => {
    const ghost = round(0, 0);
    const firstChair = ghost[1];
    if (firstChair === undefined) throw new Error("no chair");
    const verdict = judgeGhost(ghost, world([lectern(firstChair.x, firstChair.z)]));
    expect(verdict.state).toBe("refused");
    expect(verdict.obstacle?.obstacleId).toBe("lectern");
  });

  it("names a table's chairs by its number, else by its kind", () => {
    const placed = round(0, 0, "Table 2");
    const chair = placed[1];
    if (chair === undefined) throw new Error("no chair");
    expect(refusalChip(judgeGhost([lectern(chair.x, chair.z, "ghost")], world(placed)).obstacle))
      .toMatch(/^Won't fit · would overlap Table 2's chairs by \d\.\d m$/u);
    const unnumbered = round(0, 0);
    const other = unnumbered[1];
    if (other === undefined) throw new Error("no chair");
    expect(judgeGhost([lectern(other.x, other.z, "ghost")], world(unnumbered)).obstacle?.obstacleLabel).toBe("the round's chairs");
  });

  it("would sit on a dance floor rather than overlap it", () => {
    const params = cardParamsFor("dance-floor");
    if (params === null) throw new Error("no dance floor");
    const floor = stampSetup(params, { x: 0, z: 0 }, 0, ids);
    expect(refusalChip(judgeGhost([lectern(0, 0, "ghost")], world(floor)).obstacle)).toBe("Won't fit · would sit on the dance floor");
  });

  it("is never in its own way when lifted", () => {
    const placed = round(0, 0);
    const lifted = new Set(placed.map((piece) => piece.id));
    expect(judgeGhost(placed, world(placed), { excludeIds: lifted }).state).toBe("fits");
    expect(judgeGhost(placed, world(placed)).state).toBe("refused");
  });
});

describe("the chip's timing and words", () => {
  it("shows only after 80 ms of continuous refusal", () => {
    expect(refusalChipVisible(null, 1_000)).toBe(false);
    expect(refusalChipVisible(1_000, 1_079)).toBe(false);
    expect(refusalChipVisible(1_000, 1_080)).toBe(true);
  });

  it("says what letting go does", () => {
    expect(refusalSubLine(true)).toBe("Let go and it goes back to the card");
    expect(refusalSubLine(false)).toBe("Move it clear to set it down");
  });
});
