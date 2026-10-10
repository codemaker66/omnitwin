import tradesHallCell from "./normals/haduk-grid-1km-1991-2020-e259500-n665500.json" with { type: "json" };
import { SkyNormalsFileSchema, type SkyNormalsFile } from "./normals.js";

// ---------------------------------------------------------------------------
// The committed monthly normals (T-647): one file per HadUK-Grid 1 km cell,
// written by scripts/generate-sky-normals.ts from the sha256-pinned CEDA
// files and never edited by hand. Each is validated when the API loads, so
// a malformed file stops the API at startup rather than answering with it.
//
// e259500-n665500: the cell containing the Trades Hall site agreed with
// T-639 (55.8593, -4.2491).
// ---------------------------------------------------------------------------

export const SKY_NORMALS: readonly SkyNormalsFile[] = [SkyNormalsFileSchema.parse(tradesHallCell)];
