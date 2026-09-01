// ---------------------------------------------------------------------------
// Which capture on disk backs which Trades Hall room.
//
// Capture roots are machine-specific, so they are supplied on the command line
// (`--scans`, `--grand-hall`). What lives in the repo is the *mapping*: the
// directory name inside a capture root, and the room slug it serves. That is
// project knowledge and belongs under review; an operator's drive letter is
// not.
//
// `publishedExtentM` is the venue's own published room size, used only as a
// cross-check on the derived room frame. A large disagreement means the
// measurement, the mapping, or the published figure is wrong — all three are
// worth a human look, and none should be silently accepted.
// ---------------------------------------------------------------------------

export interface CaptureSource {
  /** Canonical room slug in `@omnitwin/types`. */
  readonly roomSlug: string;
  /** Directory name within the scans root, or within the Grand Hall root. */
  readonly captureDir: string;
  /** Which root `captureDir` is relative to. */
  readonly root: "scans" | "grand-hall";
  /** Basename XGRIDS gave the manifest and room mesh. */
  readonly assetBaseName: string;
  /** Venue's published width x depth x height in metres, when published. */
  readonly publishedExtentM: readonly [number, number, number] | null;
  /** Recorded where the capture and the registry disagree, or a name is odd. */
  readonly note: string | null;
  /**
   * Optional explicit crop in XGRIDS source metres, applied before measuring.
   *
   * Captures differ in kind. Some are single-room scans that measure cleanly on
   * their own; others are whole-floor scans in which the room is a small part
   * of a much larger walk, and no automatic per-axis measurement can isolate
   * one room from those without being told where to look.
   *
   * A crop here is reviewable project data with its derivation recorded in
   * `note`, not a magic constant buried in the measurement code. Null means the
   * capture is measured as-is.
   */
  readonly roomCropM: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | null;
}

export const TRADES_HALL_CAPTURE_SOURCES: readonly CaptureSource[] = [
  {
    roomSlug: "grand-hall",
    captureDir: "scans_BIG_MODEL_TH_GH_2",
    root: "grand-hall",
    assetBaseName: "Grand_Hall",
    publishedExtentM: [21, 10, 7],
    note:
      "GH_1/2/3 carry byte-identical manifests; GH_2 is the only SOG variant that also ships the room mesh. " +
      "The smaller scan_output_1_GH_SMALL capture is deliberately excluded. " +
      "Crop derived 2026-09-01: the uncropped mesh's lowest slab sits at z ≈ -6.3, a storey down and ~18 m " +
      "outside the hall (x ≈ -30), and obj-bounds took it as the floor, so every vertical figure (transform, " +
      "extent height 12.9 m, eye height 3.0 m, spawn) was measured from it and visitors stood ~1 m under the " +
      "hall floor. x/y = the trimmed walk region (-9.96..0.13, -18.51..1.36) + 0.6 m; z-min = 1.1 m below the " +
      "hall floor slab (walk-footprint histogram peaks at -2.75/-2.25); z-max = mesh max 8.62 + margin. " +
      "Measured through the tool: 11.3 x 21.1 x 7.44 m, 92% retention, confident.",
    roomCropM: { min: [-10.6, -19.1, -3.2], max: [0.7, 2.0, 9.0] },
  },
  {
    roomSlug: "reception-room",
    captureDir: "scan_output_1_reception",
    root: "scans",
    assetBaseName: "Reception_Room",
    publishedExtentM: [13.4, 11.2, 3.2],
    note: "Supersedes the older Reception tiles committed under packages/web/public/splats/reception.",
    roomCropM: null,
  },
  {
    roomSlug: "saloon",
    captureDir: "scan_output_1_saloon",
    root: "scans",
    assetBaseName: "The Saloon",
    publishedExtentM: [12, 7, 5.4],
    note: null,
    roomCropM: null,
  },
  {
    roomSlug: "robert-adam-room",
    captureDir: "scan_output_1_robertadam",
    root: "scans",
    assetBaseName: "The Robert Adam Room",
    publishedExtentM: [9.7, 5.6, 2.18],
    note: null,
    roomCropM: null,
  },
  {
    roomSlug: "lady-convenors-room",
    captureDir: "scan_output_1_lady",
    root: "scans",
    assetBaseName: "Lady_Conveynor",
    publishedExtentM: null,
    note: "XGRIDS spelled the export 'Lady_Conveynor'; the canonical slug is lady-convenors-room.",
    roomCropM: null,
  },
  {
    roomSlug: "north-gallery",
    captureDir: "scan_output_1_north",
    root: "scans",
    assetBaseName: "North Gallery",
    publishedExtentM: null,
    note: null,
    roomCropM: null,
  },
  {
    roomSlug: "south-gallery",
    captureDir: "scan_output_1_south",
    root: "scans",
    assetBaseName: "South Gallery",
    publishedExtentM: null,
    note: "Crop derived 2026-09-01: a 5 m stair at x <= -8 and a west annex dragged the mesh frame; x-min sits just inside the annex west wall (mesh density peak at x -8..-7) so the stair is excluded and the annex kept, y = mesh frame +/- 0.4, z = floor -1.88 - 0.4 to ceiling 1.61 + 0.6. Measured through the tool: 99% retention, confident.",
    roomCropM: { min: [-6.5, -12.0, -2.3], max: [2.2, 1.6, 2.2] },
  },
  {
    roomSlug: "deacon-conveners-room",
    captureDir: "scan_output_1_DC",
    root: "scans",
    assetBaseName: "DC_Room",
    publishedExtentM: null,
    note:
      "The Deacon Convener's Room. Note the repo's existing lady-convenors-room uses the '-or' spelling " +
      "while the Trades House office is 'Convener'; the existing slug is left alone deliberately.",
    roomCropM: null,
  },
] as const;

export function captureSourceForRoom(roomSlug: string): CaptureSource | null {
  return TRADES_HALL_CAPTURE_SOURCES.find((source) => source.roomSlug === roomSlug) ?? null;
}
