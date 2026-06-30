import { fixtureFamilyLabel, type DmxPatch } from "./dmx.js";

// ---------------------------------------------------------------------------
// patch-sheet — export the planned rig's DMX patch as a sheet (Epic 6, slice 7).
//
// Turns the DMX patch (lib/dmx.ts, which already assigns each fixture a universe +
// start/end address) into a row-per-fixture patch sheet + a CSV a venue can hand
// to a lighting designer / electrician. Works for the WHOLE rig — both family-count
// fixtures and imported GDTF fixtures (their real channel footprint already flows
// through buildDmxPatch). Pure; the download happens in the panel.
// ---------------------------------------------------------------------------

export interface PatchSheetRow {
  readonly fixtureNumber: number;
  /** Manufacturer + model for an imported fixture, else the family label. */
  readonly model: string;
  readonly family: string;
  readonly channels: number;
  readonly universe: number;
  readonly startAddress: number;
  readonly endAddress: number;
}

export function buildPatchSheetRows(patch: DmxPatch): PatchSheetRow[] {
  return patch.fixtures.map((fixture, index) => ({
    fixtureNumber: index + 1,
    model: fixture.label,
    family: fixtureFamilyLabel(fixture.family),
    channels: fixture.channels,
    universe: fixture.universe,
    startAddress: fixture.startAddress,
    endAddress: fixture.endAddress,
  }));
}

const PATCH_SHEET_HEADER = ["Fixture", "Model", "Family", "Channels", "Universe", "Start", "End"] as const;

/** RFC-4180-style field quoting (commas / quotes / newlines). */
function csvField(value: string | number): string {
  const text = String(value);
  return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The patch as CSV (CRLF rows, trailing newline) for Excel / Sheets / an LD. */
export function patchSheetCsv(patch: DmxPatch): string {
  const lines = [PATCH_SHEET_HEADER.join(",")];
  for (const row of buildPatchSheetRows(patch)) {
    lines.push([
      row.fixtureNumber, row.model, row.family, row.channels, row.universe, row.startAddress, row.endAddress,
    ].map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const PATCH_SHEET_FILENAME = "dmx-patch-sheet.csv";
