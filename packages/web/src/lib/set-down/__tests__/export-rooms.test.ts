// The rooms the offline ray tracer traces: tools/set-down-acoustics/rooms.json
// (T-700, Task 7). The export itself runs only with EXPORT=1:
//   EXPORT=1 pnpm exec vitest run src/lib/set-down/__tests__/export-rooms.test.ts
// It lives here, not under tools/, because packages/web's vitest only includes
// src/**. The other tests always run: the committed rooms.json must equal the
// model's export now (ruling R38), and each prism must keep the model's room.

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROOM_ACOUSTICS } from "../rooms.js";
import { ROOMS_JSON, areaOf, partOf, tracedDome, tracerPrism, tracerRoomsFile, wallExtentM2 } from "./tracer-export.js";
import { TRACED_ROOMS } from "./tracer-results.js";

/** The export as it reads back from JSON, so it compares with the file value for value. */
function exportAsJson(): unknown {
  return JSON.parse(JSON.stringify(tracerRoomsFile()));
}

describe("the ray tracer's rooms", () => {
  it("keeps the committed rooms.json equal to the model's export, so the trace is of these rooms", () => {
    expect(JSON.parse(readFileSync(ROOMS_JSON, "utf8"))).toEqual(exportAsJson());
  });

  it("gives each room a prism that keeps the model's volume, floor and walls, and the Grand Hall alone a dome", () => {
    for (const slug of TRACED_ROOMS) {
      const room = ROOM_ACOUSTICS[slug];
      const dome = tracedDome(slug);
      const prism = tracerPrism(slug);
      const prismVolume = prism.lengthM * prism.widthM * prism.heightM + (dome?.volumeM3 ?? 0);
      expect(prismVolume).toBeCloseTo(room.volumeM3, 6);
      expect(prism.lengthM * prism.widthM).toBeCloseTo(areaOf(room, (surface) => surface.role === "floor"), 6);
      expect(2 * (prism.lengthM + prism.widthM) * prism.heightM).toBeCloseTo(wallExtentM2(room), 6);
      const domes = room.surfaces.filter((surface) => partOf(surface, dome !== null) === "dome");
      expect(domes.map((surface) => surface.areaM2)).toEqual(dome === null ? [] : [dome.surfaceM2]);
    }
  });

  it.skipIf(process.env["EXPORT"] !== "1")("exports every room to tools/set-down-acoustics/rooms.json", () => {
    writeFileSync(ROOMS_JSON, `${JSON.stringify(tracerRoomsFile(), null, 2)}\n`);
    expect(JSON.parse(readFileSync(ROOMS_JSON, "utf8"))).toEqual(exportAsJson());
  });
});
