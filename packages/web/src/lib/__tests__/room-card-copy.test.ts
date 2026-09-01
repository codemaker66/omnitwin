import { describe, expect, it } from "vitest";
import { roomSplatBundle, roomSplatServedSplats } from "../../data/room-splat-bundles.js";
import { footprint, measuredLine, splatLine, stateLine } from "../room-card-copy.js";

// The front door's card copy, as data. Alignment confidence (can the mesh
// frame be trusted) and walkability (can the walk box hold a visitor) are
// orthogonal, so every combination is pinned here rather than left to
// whatever today's manifest happens to contain.
function bundle(slug: string) {
  const found = roomSplatBundle(slug);
  if (found === null) throw new Error(`fixture room missing: ${slug}`);
  return found;
}

describe("room card copy", () => {
  it("prints dimensions only for a room that is both confident and walkable", () => {
    const reception = bundle("reception-room");
    expect(reception.alignmentConfidence).toBe("confident");
    expect(measuredLine(reception, true)).toBe(`${footprint(reception)} · ${splatLine(reception)}`);
    expect(measuredLine(reception, true)).toMatch(/ m · /u);
  });

  it("withholds dimensions from a closed room even when its mesh alignment is confident", () => {
    const reception = bundle("reception-room");
    const line = measuredLine(reception, false);
    expect(line).not.toMatch(/ m(\s|·|$)/u);
    expect(line).toContain(splatLine(reception));
    expect(stateLine(reception, false)).toMatch(/being aligned/iu);
    expect(stateLine(reception, false)).toMatch(/not yet walkable/iu);
  });

  it("marks a walkable room under review and withholds its dimensions", () => {
    const saloon = bundle("saloon");
    expect(saloon.alignmentConfidence).toBe("review");
    expect(measuredLine(saloon, true)).toBe(`${splatLine(saloon)} · alignment in review`);
    expect(stateLine(saloon, true)).toMatch(/walkable/iu);
    expect(stateLine(saloon, true)).toMatch(/dimensions withheld/iu);
  });

  it("has nothing to add for a room that is confident and walkable", () => {
    expect(stateLine(bundle("deacon-conveners-room"), true)).toBeNull();
  });

  it("counts the splats a visitor will see, never the all-levels sum", () => {
    const grandHall = bundle("grand-hall");
    expect(splatLine(grandHall)).toBe(`${roomSplatServedSplats("grand-hall").toLocaleString("en-GB")} splats`);
    expect(splatLine(grandHall)).not.toContain(grandHall.totalSplats.toLocaleString("en-GB"));
  });

  it("prints the footprint as width by depth by height in metres", () => {
    const [width, height, depth] = bundle("reception-room").extentM;
    expect(footprint(bundle("reception-room")))
      .toBe(`${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} m`);
  });
});
