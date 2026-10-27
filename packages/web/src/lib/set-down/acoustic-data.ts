// ---------------------------------------------------------------------------
// Published absorption of Trades Hall's surfaces, its furniture and its air
// (T-677).
//
// Surface rows are absorption coefficients (alpha, ISO 354 convention). Object
// rows are equivalent absorption area in m2 per piece. Bands run 125 Hz to
// 8 kHz; where a source has no 8 kHz value the 4 kHz value stands in. Each row
// ends with its label and source, copied from the research file
// (acoustic-data.md, sections 1 and 2):
//   LAB      measured in a reverberation room, report seen
//   FIELD    measured in a real room
//   TEXTBOOK a published compilation whose original measurement is untraced
//   CALC     calculated from a cited formula or cited data
//   EST      an engineering estimate bracketed by the cited numbers
// "James" is the Adrian James absorption compilation,
// https://www.acoustic.ua/st/web_absorption_data_eng.pdf
// ---------------------------------------------------------------------------

import type { BandValues } from "./bands.js";

export type SurfaceMaterialId =
  | "oak-boards-joists"
  | "parquet-timber-subfloor"
  | "timber-on-slab"
  | "carpet-on-underlay"
  | "plaster-masonry"
  | "plaster-lath"
  | "plasterboard-studs"
  | "hardwood-panelling"
  | "sash-glazing"
  | "leaded-glass"
  | "velour-drape"
  | "sheer-curtain"
  | "marble"
  | "timber-door";

/** Absorption coefficient of each surface material, per octave band. */
export const SURFACE_ABSORPTION: Readonly<Record<SurfaceMaterialId, BandValues>> = {
  "oak-boards-joists": [0.15, 0.11, 0.1, 0.07, 0.06, 0.07, 0.07], // TEXTBOOK James "wooden floor on joists"; roomtreat.com/data/absorption-coefficients
  "parquet-timber-subfloor": [0.14, 0.11, 0.09, 0.08, 0.06, 0.07, 0.07], // EST blend of James "parquet on counterfloor" and the joist floor
  "timber-on-slab": [0.04, 0.04, 0.07, 0.06, 0.06, 0.07, 0.07], // TEXTBOOK James "parquet fixed in asphalt, on concrete"; RoomTreat
  "carpet-on-underlay": [0.08, 0.12, 0.35, 0.55, 0.7, 0.72, 0.72], // TEXTBOOK James "9 mm tufted on felt underlay" and "thick pile on sponge rubber"
  "plaster-masonry": [0.02, 0.02, 0.03, 0.04, 0.05, 0.05, 0.05], // TEXTBOOK James "lime cement plaster on masonry wall"
  "plaster-lath": [0.15, 0.12, 0.08, 0.05, 0.04, 0.04, 0.04], // EST between James "plaster on lath, deep air space" and "plaster decorative panels"
  "plasterboard-studs": [0.29, 0.1, 0.05, 0.04, 0.07, 0.09, 0.09], // TEXTBOOK James, 12 mm on 50 mm battens; RoomTreat
  "hardwood-panelling": [0.28, 0.22, 0.12, 0.09, 0.08, 0.08, 0.08], // EST from James hardwood panels over 25 mm airspace and 12 mm panelling on battens
  "sash-glazing": [0.25, 0.15, 0.08, 0.05, 0.04, 0.03, 0.03], // EST from James "4 mm glass" and pyroomacoustics "glass_window"
  "leaded-glass": [0.2, 0.15, 0.1, 0.07, 0.05, 0.05, 0.05], // EST, pyroomacoustics "lead_glazing" damped slightly; no measured source
  "velour-drape": [0.08, 0.35, 0.8, 0.98, 0.95, 0.9, 0.9], // EST anchored by LAB Mueller-BBM B300007-01/TB09 (420 g/m2 velour, 100 % fullness, 100 mm off wall)
  "sheer-curtain": [0.02, 0.04, 0.1, 0.25, 0.4, 0.5, 0.5], // EST bracketed by Carnegie sheer fabric NRC and James lightweight curtains
  marble: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.02], // TEXTBOOK James, marble chimneypiece
  "timber-door": [0.14, 0.1, 0.06, 0.08, 0.1, 0.1, 0.1], // TEXTBOOK James "solid timber door"
};

/** Air attenuation per metre at 20 C and 50 % humidity, per octave band (ISO 9613-1). */
export const AIR_ATTENUATION_PER_M: BandValues = [1.0e-4, 3.0e-4, 6.3e-4, 1.07e-3, 2.28e-3, 6.83e-3, 2.42e-2]; // CALC from ISO 9613-1 pure-tone formula, m = dB/km / 4.343 / 1000

export type AbsorberKind =
  | "chair-hard"
  | "chair-cushioned"
  | "chair-upholstered"
  | "table-bare"
  | "round-clothed"
  | "trestle-clothed"
  | "poseur-covered"
  | "fabric-face"
  | "none";

/** Equivalent absorption area of one piece, in m2 per octave band. */
export const OBJECT_ABSORPTION: Readonly<
  Record<Exclude<AbsorberKind, "fabric-face" | "none">, BandValues>
> = {
  "chair-hard": [0.03, 0.03, 0.04, 0.05, 0.06, 0.06, 0.06], // LAB-anchored EST, SP/RISE report 6P10120 (skandiform.se/media/3331/decibel_report.pdf), Carvalho & Pino pews
  "chair-cushioned": [0.04, 0.05, 0.09, 0.13, 0.15, 0.15, 0.15], // EST, frame plus a 0.16 m2 foam cushion; SP padded-chair measurement as upper reference
  "chair-upholstered": [0.08, 0.1, 0.17, 0.24, 0.27, 0.27, 0.27], // EST bracketed by the SP padded chair and James "fully upholstered seats"
  "table-bare": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], // EST, EN 12354-6 hard object A = V^(2/3), frequency independent (research file has 0.05 / 0.06 / 0.08 at 125 / 250 / 500 Hz)
  "round-clothed": [0.1, 0.2, 0.4, 0.5, 0.6, 0.6, 0.6], // EST +-50 %, no published value; 4.1 m2 light cloth skirt at alpha 0.02 to 0.15
  "trestle-clothed": [0.06, 0.12, 0.25, 0.3, 0.35, 0.35, 0.35], // EST scaled from the clothed round table by skirt area
  "poseur-covered": [0.03, 0.06, 0.12, 0.15, 0.18, 0.18, 0.18], // EST, half the clothed trestle; no source
};

/** Absorption of a hung fabric face, per m2 of face (heavy velour). */
export const FABRIC_FACE_PER_M2: BandValues = SURFACE_ABSORPTION["velour-drape"];
