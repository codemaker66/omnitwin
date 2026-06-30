import { describe, it, expect } from "vitest";
import { buildPatchSheetRows, patchSheetCsv } from "../patch-sheet.js";
import { buildDmxPatch } from "../dmx.js";

describe("buildPatchSheetRows", () => {
  it("builds a numbered row per fixture with its patched address", () => {
    const rows = buildPatchSheetRows(buildDmxPatch([{ family: "par", count: 2 }])); // PAR = 7 ch
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ fixtureNumber: 1, family: "PAR", channels: 7, universe: 1, startAddress: 1, endAddress: 7 });
    expect(rows[1]).toMatchObject({ fixtureNumber: 2, startAddress: 8, endAddress: 14 });
  });

  it("carries an imported fixture's real channels + model label", () => {
    const rows = buildPatchSheetRows(buildDmxPatch([{ family: "beam-hybrid", count: 1, channels: 40, label: "Robe MegaPointe" }]));
    expect(rows[0]).toMatchObject({ model: "Robe MegaPointe", family: "Beam / hybrid", channels: 40, endAddress: 40 });
  });
});

describe("patchSheetCsv", () => {
  it("renders a header + CRLF rows", () => {
    const lines = patchSheetCsv(buildDmxPatch([{ family: "par", count: 1 }])).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Fixture,Model,Family,Channels,Universe,Start,End");
    expect(lines[1]).toBe("1,PAR,PAR,7,1,1,7");
  });

  it("escapes fields containing commas and quotes", () => {
    const csv = patchSheetCsv(buildDmxPatch([{ family: "par", count: 1, label: 'Acme "Big", PAR' }]));
    expect(csv).toContain('"Acme ""Big"", PAR"');
  });

  it("is header-only for an empty rig", () => {
    expect(patchSheetCsv(buildDmxPatch([])).trimEnd()).toBe("Fixture,Model,Family,Channels,Universe,Start,End");
  });
});
