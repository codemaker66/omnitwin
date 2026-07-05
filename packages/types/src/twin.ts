import { z } from "zod";

// -----------------------------------------------------------------------------
// twin/0 — the Venviewer Twin bundle manifest (spec:
// docs/superpowers/specs/2026-07-02-twin-program-design.md §4.2).
// Poses stay in the E57 capture frame (Z-up, metres, +X scanner-forward);
// basis conversion is the viewer's job (packages/web twin-basis).
// -----------------------------------------------------------------------------

export const TWIN_SCHEMA_ID = "twin/0" as const;
export const TWIN_FACES = ["front", "back", "left", "right", "up", "down"] as const;
export const TWIN_LODS = [256, 1024] as const;
/** Equirect LODs are WIDTHS (2:1 aspect): 512×256 preview, 4096×2048 full.
 *  4096 ⇒ 11.4 px/deg — sharpness parity with the legacy cube tiles; the
 *  first equirect ship at 2048 halved that and read as visibly soft. */
export const TWIN_EQUIRECT_LODS = [512, 4096] as const;

export type TwinFace = (typeof TWIN_FACES)[number];
export type TwinLod = (typeof TWIN_LODS)[number];
export type TwinEquirectLod = (typeof TWIN_EQUIRECT_LODS)[number];

/**
 * Imagery mode of a bundle. `cube-faces` is the original six-face pipeline;
 * `equirect` is one seamless world-frame equirectangular pano per node
 * (E57 workspace extract_equirect.py — no per-face table, no cube seams).
 * The `.default("cube-faces")` keeps every pre-equirect manifest parsing.
 */
export const TwinImagerySchema = z.enum(["cube-faces", "equirect"]).default("cube-faces");
export type TwinImagery = z.infer<typeof TwinImagerySchema>;

export const TwinPoseSchema = z.object({
  /** Quaternion [w, x, y, z] — scanner→E57-world rotation, as captured. */
  q: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Translation [x, y, z] in metres, E57 world frame (Z-up). */
  t: z.tuple([z.number(), z.number(), z.number()]),
});
export type TwinPose = z.infer<typeof TwinPoseSchema>;

export const TwinScanNodeSchema = z.object({
  id: z.string().regex(/^scan_\d{3}$/),
  index: z.number().int().nonnegative(),
  pose: TwinPoseSchema,
  /** Floor bucket derived from pose height clusters; 0 = ground. */
  floor: z.number().int(),
  /** Link into the venue's room taxonomy when known; null until tagged. */
  roomSlug: z.string().nullable(),
});
export type TwinScanNode = z.infer<typeof TwinScanNodeSchema>;

export const TwinNavEdgeSchema = z.object({
  a: z.string(),
  b: z.string(),
  distanceM: z.number().positive(),
});
export type TwinNavEdge = z.infer<typeof TwinNavEdgeSchema>;

export const TwinMeshSchema = z.object({
  /** Bundle-relative location — fixed so viewers never guess. */
  path: z.literal("mesh/dollhouse.glb"),
  bytes: z.number().int().positive(),
  /** Basename of the source GLB the forge optimized (provenance). */
  sourceName: z.string().min(1),
});
export type TwinMesh = z.infer<typeof TwinMeshSchema>;

export const TwinCaptureSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matterport-e57"), scanCount: z.number().int().positive() }),
  z.object({ kind: z.literal("xgrids-lcc") }),
  z.object({ kind: z.literal("photo-mapanything") }),
]);
export type TwinCaptureSource = z.infer<typeof TwinCaptureSourceSchema>;

/** ADR-015-aligned planning tier; never implies certification (ADR-012). */
export const TwinTierSchema = z.enum([
  "survey-grade-1cm",
  "ops-grade-2cm",
  "planning-grade-5cm",
]);

export const TwinManifestSchema = z
  .object({
    schema: z.literal(TWIN_SCHEMA_ID),
    venueSlug: z.string().min(1),
    name: z.string().min(1),
    capture: TwinCaptureSourceSchema,
    tier: TwinTierSchema,
    upAxis: z.literal("z"),
    units: z.literal("m"),
    /** Absent in pre-equirect bundles → defaults to the cube-face pipeline. */
    imagery: TwinImagerySchema,
    /** Vestigial in equirect mode (kept so older manifests parse unchanged). */
    faces: z.tuple([
      z.literal("front"), z.literal("back"), z.literal("left"),
      z.literal("right"), z.literal("up"), z.literal("down"),
    ]),
    /** Cube mode: face edge px [256, 1024]. Equirect mode: widths [512, 4096]. */
    lods: z.union([
      z.tuple([z.literal(256), z.literal(1024)]),
      z.tuple([z.literal(512), z.literal(4096)]),
    ]),
    generatedAt: z.string().datetime(),
    nodes: z.array(TwinScanNodeSchema).min(1),
    edges: z.array(TwinNavEdgeSchema),
    /** Optional dollhouse mesh — bundles without one keep working (Phase 2). */
    mesh: TwinMeshSchema.optional(),
    /** SHA-256 per bundle entry, filled by twin-forge hash step (D-014 shape). */
    contentHashes: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((manifest, ctx) => {
    const expected = manifest.imagery === "equirect" ? TWIN_EQUIRECT_LODS : TWIN_LODS;
    if (manifest.lods[0] !== expected[0] || manifest.lods[1] !== expected[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lods"],
        message: `${manifest.imagery} bundles must declare lods [${expected.join(", ")}]`,
      });
    }
  });
export type TwinManifest = z.infer<typeof TwinManifestSchema>;

export function twinTilePath(nodeId: string, face: TwinFace, lod: TwinLod): string {
  return `tiles/${nodeId}/${face}_${String(lod)}.webp`;
}

/** Bundle-relative path of one node's equirect pano at the given width. */
export function twinEquirectPath(nodeId: string, lod: TwinEquirectLod): string {
  return `tiles/${nodeId}/equirect_${String(lod)}.webp`;
}
