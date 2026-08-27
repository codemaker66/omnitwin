import { z } from "zod";

// ---------------------------------------------------------------------------
// XGRIDS `.lcc2` manifest.
//
// The file is plain JSON emitted by XGRIDS LCC (PortalCam handheld SLAM). It
// describes a Gaussian-splat octree: `root` is a recursive node whose children
// are keyed by stringified index, and whose `splatFiles` list names every tile
// on disk. A node's `id` ("0_7_0_0") is also its tile basename, so octree depth
// and LOD level are the same number.
//
// This schema is deliberately strict about the parts we depend on (bounds,
// encoding, tile list) and permissive about the parts XGRIDS may change between
// exporter versions. A capture that fails validation is refused, not coerced —
// a silently mis-parsed bound would place a room in the wrong place on screen.
// ---------------------------------------------------------------------------

/** Splat encodings XGRIDS emits. `.lcc` v1 monolithic exports are not tiled. */
export const LCC2_SPLAT_TYPES = [".sog", ".spz", ".ply"] as const;
export type Lcc2SplatType = (typeof LCC2_SPLAT_TYPES)[number];

const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const Lcc2BoundingBoxSchema = z
  .object({ min: Vec3Schema, max: Vec3Schema })
  .superRefine((box, ctx) => {
    for (let axis = 0; axis < 3; axis += 1) {
      const min = box.min[axis] ?? 0;
      const max = box.max[axis] ?? 0;
      if (min > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["min", axis],
          message: `Bounding box min exceeds max on axis ${String(axis)}.`,
        });
      }
    }
  });
export type Lcc2BoundingBox = z.infer<typeof Lcc2BoundingBoxSchema>;

export interface Lcc2Node {
  readonly id: string;
  readonly boundingBox: Lcc2BoundingBox;
  readonly childNum: number;
  readonly child: Readonly<Record<string, Lcc2Node>>;
  readonly splatFiles?: readonly string[];
  readonly meshFiles?: readonly string[];
  readonly bvhFiles?: readonly string[];
}

// The node schema is recursive, so it is declared against the hand-written
// `Lcc2Node` interface above and tied together with z.lazy.
//
// The third generic argument (input = unknown) is load-bearing: `child` carries
// a .default({}) on a .passthrough() object, so the schema's INPUT type differs
// from its output. A two-argument `ZodType<Lcc2Node>` demands they match and
// rejects this. See .claude/gotchas/zod-passthrough-inference.md.
export const Lcc2NodeSchema: z.ZodType<Lcc2Node, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    boundingBox: Lcc2BoundingBoxSchema,
    childNum: z.number().int().nonnegative(),
    child: z.record(z.string(), Lcc2NodeSchema).default({}),
    splatFiles: z.array(z.string().min(1)).optional(),
    meshFiles: z.array(z.string().min(1)).optional(),
    bvhFiles: z.array(z.string().min(1)).optional(),
  }).passthrough(),
);

export const Lcc2ManifestSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  guid: z.string().min(1),
  source: z.string().min(1),
  dataType: z.string().min(1),
  offset: Vec3Schema,
  shift: Vec3Schema,
  scale: Vec3Schema,
  fileType: z.string().min(1),
  totalSplats: z.number().int().positive(),
  lodSplats: z.array(z.number().int().nonnegative()),
  totalLevels: z.number().int().positive(),
  splatType: z.enum(LCC2_SPLAT_TYPES),
  env: z.object({
    type: z.string().min(1),
    splatsCount: z.number().int().nonnegative(),
    boundingBox: Lcc2BoundingBoxSchema,
  }),
  root: Lcc2NodeSchema,
}).passthrough();

export type Lcc2Manifest = z.infer<typeof Lcc2ManifestSchema>;

/** The environment shell is a sky sphere, never room geometry. */
export const LCC2_ENV_TILE_ID = "env";

/**
 * A tile's octree node id is its basename: "data/3dgs/0_7_0_0.sog" -> "0_7_0_0".
 */
export function tileIdForSplatFile(splatFile: string): string {
  const base = splatFile.split("/").pop() ?? splatFile;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

/**
 * Octree depth is the LOD level: "0_0" is level 1 (coarsest and loaded first),
 * "0_7_0_0_1_1" is level 5. The environment shell has no depth, so it has no
 * level — it is loaded once and never refined.
 */
export function lodLevelForTileId(tileId: string): number | null {
  if (tileId === LCC2_ENV_TILE_ID) return null;
  const segments = tileId.split("_");
  if (segments.some((segment) => !/^\d+$/.test(segment))) return null;
  return segments.length - 1;
}

export interface Lcc2ParseResult {
  readonly ok: boolean;
  readonly manifest: Lcc2Manifest | null;
  readonly error: string | null;
}

/**
 * Parses raw `.lcc2` bytes. Returns the failure rather than throwing so callers
 * can report which capture is unusable and continue with the rest.
 */
export function parseLcc2Manifest(raw: string): Lcc2ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, manifest: null, error: "Manifest is not valid JSON." };
  }

  const parsed = Lcc2ManifestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? "manifest" : first.path.join(".");
    const why = first?.message ?? "unknown validation failure";
    return { ok: false, manifest: null, error: `Manifest failed validation at ${where}: ${why}` };
  }

  return { ok: true, manifest: parsed.data, error: null };
}
