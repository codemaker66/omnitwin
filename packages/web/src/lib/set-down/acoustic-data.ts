// ---------------------------------------------------------------------------
// Published absorption of Trades Hall's surfaces, its furniture and its air
// (T-700).
//
// Surface rows are absorption coefficients (alpha, ISO 354 convention). Object
// rows are equivalent absorption area in m2 per piece. Bands run 125 Hz to
// 8 kHz; where a source has no 8 kHz value the 4 kHz value stands in. Each row
// ends with its label and its primary source:
//   LAB      measured in a reverberation room, report seen
//   FIELD    measured in a real room
//   TEXTBOOK a published compilation whose original measurement is untraced
//   CALC     calculated from a cited formula or cited data
//   EST      an engineering estimate: the row says what it rests on, and why
//            no source gives the figure directly
// "James" is Adrian James's compilation "Absorption coefficients" (9 pages,
// 2014), https://www.acoustic.ua/st/web_absorption_data_eng.pdf; "p." is a
// page of that PDF. James stops at 4 kHz, so every 8 kHz figure below is EST.
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
  "oak-boards-joists": [0.15, 0.11, 0.1, 0.07, 0.06, 0.07, 0.08], // TEXTBOOK James p.6 "Wooden floor on joists"; 8 kHz EST, 0.01 over 4 kHz as the row rises
  "parquet-timber-subfloor": [0.14, 0.11, 0.09, 0.08, 0.06, 0.07, 0.08], // EST between James p.6 "Parquet on counterfloor" (0.20/0.15/0.10/0.10/0.05/0.10) and "Wooden floor on joists", nearer the joists since herringbone parquet is thicker and heavier; 125 and 500 Hz sit 0.01 under both rows; 8 kHz EST, 0.01 over 4 kHz
  "timber-on-slab": [0.04, 0.04, 0.07, 0.06, 0.06, 0.07, 0.07], // TEXTBOOK James p.6 "Parquet fixed in asphalt, on concrete"; 8 kHz EST, the 4 kHz value
  "carpet-on-underlay": [0.08, 0.12, 0.35, 0.55, 0.7, 0.72, 0.72], // EST between James p.6 "9mm pile carpet, tufted on felt underlay" (0.08/0.08/0.30/0.60/0.75/0.80) and "Thick pile carpet on sponge rubber underlay" (0.15/0.25/0.50/0.60/0.70/0.70), nearer the thinner; 1 kHz sits 0.05 under both; 8 kHz EST, the 4 kHz value
  "plaster-masonry": [0.02, 0.02, 0.03, 0.04, 0.05, 0.05, 0.06], // TEXTBOOK James p.1 "Lime cement plaster on masonry wall"; 8 kHz EST, 0.01 over 4 kHz
  "plaster-lath": [0.2, 0.15, 0.1, 0.05, 0.05, 0.05, 0.05], // TEXTBOOK James p.5 "Plaster on lath, deep air space" (wall treatments and constructions); 8 kHz EST, the 4 kHz value
  "plasterboard-studs": [0.29, 0.1, 0.05, 0.04, 0.07, 0.09, 0.1], // TEXTBOOK James p.1 "Plasterboard on 50mm battens"; 8 kHz EST, 0.01 over 4 kHz as the row rises
  "hardwood-panelling": [0.28, 0.22, 0.12, 0.09, 0.08, 0.08, 0.08], // EST within James p.2 "Plywood, hardwood panels over 25mm airspace on solid backing" (0.30/0.20/0.15/0.10/0.10/0.05), "12mm wood panelling on 25mm battens" (0.31/0.33/0.14/0.10/0.10/0.12) and pyroomacoustics "plywood_thin" (0.42/0.21/0.10/0.08/0.06/0.06), except 125 Hz, just under all three, as thick solid mahogany is stiffer than any of those panels; 8 kHz EST, the 4 kHz value
  "sash-glazing": [0.25, 0.15, 0.08, 0.05, 0.04, 0.03, 0.03], // EST between James p.2 "4mm glass" (0.30/0.20/0.10/0.07/0.05/0.02) and "6mm glass" (0.10/0.06/0.04/0.03/0.02/0.02), nearer 4 mm for thin crown or float glass but under it, as small sash panes are stiffer than one large pane; 4 kHz is pyroomacoustics "glass_window" (0.03); 8 kHz EST, the 4 kHz value
  "leaded-glass": [0.2, 0.15, 0.1, 0.07, 0.05, 0.05, 0.05], // EST: pyroomacoustics materials database "lead_glazing" (0.30/0.20/0.14/0.10/0.05/0.05, origin not stated) taken lower below 2 kHz, as small leaded lights are stiffer than one pane; no measured source exists; 8 kHz EST, the 4 kHz value
  "velour-drape": [0.08, 0.35, 0.8, 0.98, 0.95, 0.9, 0.9], // EST anchored by LAB Mueller-BBM report B300007-01/TB09 (24 Feb 2026), Table C.1: 420 g/m2 velour, 100 % fullness, 100 mm off the wall, 0.04/0.36/0.94/1.02/0.92/0.91 from its third-octave times; 8 kHz EST, the 4 kHz value
  "sheer-curtain": [0.02, 0.04, 0.1, 0.25, 0.4, 0.5, 0.5], // EST for a 60-100 g/m2 voile at 100 % fullness, under both heavier references: James p.5 "Lightweight curtains (0.2 kg/m2) hung 90mm from wall" (0.05/0.06/0.39/0.63/0.70/0.73) and Carnegie's "Betacoustic" sheer (NRC 0.45 flat, 0.65 at 100 % fullness), an acoustic fabric; 8 kHz EST, the 4 kHz value
  marble: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.03], // TEXTBOOK James p.6 "Smooth marble or terrazzo slabs"; 8 kHz EST, 0.01 over 4 kHz
  "timber-door": [0.14, 0.1, 0.06, 0.08, 0.1, 0.1, 0.1], // TEXTBOOK James p.7 "Solid timber door"; 8 kHz EST, the 4 kHz value
};

/** Air attenuation per metre at 20 C and 50 % humidity, per octave band (ISO 9613-1). */
export const AIR_ATTENUATION_PER_M: BandValues = [1.0e-4, 3.0e-4, 6.3e-4, 1.07e-3, 2.28e-3, 6.83e-3, 2.42e-2]; // CALC from ISO 9613-1:1993's pure-tone attenuation formula (oxygen and nitrogen relaxation) at 20 C, 50 % RH, 101.325 kPa and the nominal octave centres: 0.44, 1.31, 2.73, 4.66, 9.89, 29.67, 105.3 dB/km; m = dB/km / 4.343 / 1000

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
  "chair-upholstered": [0.08, 0.1, 0.17, 0.24, 0.27, 0.27, 0.27], // EST bracketed by the SP padded chair (report 6P10120) and James p.9 "Fully upholstered seats (per item)"
  "table-bare": [0.05, 0.06, 0.08, 0.1, 0.1, 0.1, 0.1], // EST, EN 12354-6 hard irregular object A = V_obj^(2/3), about 0.1 m2 for 0.03 m3 of solid material; 8 kHz EST, the 4 kHz value
  "round-clothed": [0.1, 0.2, 0.4, 0.5, 0.6, 0.6, 0.6], // EST +-50 %, no published value; 4.1 m2 light cloth skirt at alpha 0.02 to 0.15
  "trestle-clothed": [0.06, 0.12, 0.25, 0.3, 0.35, 0.35, 0.35], // EST scaled from the clothed round table by skirt area
  "poseur-covered": [0.03, 0.06, 0.12, 0.15, 0.18, 0.18, 0.18], // EST, half the clothed trestle; no source, no 8 kHz value so 4 kHz repeats
};

/** Absorption of a hung fabric face, per m2 of face (heavy velour). */
export const FABRIC_FACE_PER_M2: BandValues = SURFACE_ABSORPTION["velour-drape"];
