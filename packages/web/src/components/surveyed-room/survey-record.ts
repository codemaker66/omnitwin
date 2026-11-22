// ---------------------------------------------------------------------------
// A surveyed room's record: survey.json, schema version 2
//
// tools/surveyed-rooms publishes survey.json beside a room's photographs and
// reliefs (roombuild/publish.py). Version 2 is version 1 with a `room` block
// (the room's name, venue, ceiling height and measured outline), each wall's
// `height` and `kind`, the wall atlas's images (`atlas.files`) and a `floor`
// block (its photograph's `extent` and `files`). Everything a room-driven
// renderer needs to place the published files comes from here, so the record
// is checked as a whole before anything is drawn from it: the outline frames
// a room, each wall matches its segment, the atlas strips fit and do not
// overlap, the relief order names exactly the walls, the ceiling's and the
// floor's photographs cover the outline, and every file the record points at
// is one it lists.
//
// Each list of images (`atlas.files`, `ceiling.files`, `floor.files`) is the
// same photograph at several sizes, largest first: a device takes the first
// or, with less memory, a later one (room-photos.ts). The record carries no
// pixel sizes, so the order is checked against each file's byte count.
//
// The ceiling and floor photographs cover their `extent` with columns along
// planner +x and rows from planner +z (the image's top row is the extent's
// highest z). The tools state that as `orientation`; where a record states
// one, it must be that one, since it is the only one drawn.
//
// Keys the web does not use (tools, glassScan, openings, linkedInputs,
// configSha256, methodRevision, the atlas's packing, the relief's meshing
// parameters) may be present and are dropped.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { isReliefId, RELIEF_ID_BYTES } from "./relief-container.js";
import { outlineBounds, outlineFault, segmentLength, type PlanPoint } from "./room-frame.js";

export const SURVEY_SCHEMA_VERSION = 2;
// The four tolerances below have a copy in the survey tools' publish step
// (tools/surveyed-rooms/roombuild/publish.py), so that it refuses, before
// anything is published, what this reader would refuse. Change the two
// together, and keep each as `export const NAME = <number>;`: the tools' test
// ReaderTolerances reads them out of this file's text, and CI's "Survey
// tools" job runs whenever this file changes.
/** How far a wall's recorded length may differ from its outline segment, metres. */
export const WALL_LENGTH_TOLERANCE = 0.002;
/**
 * How far the outline may reach past the rectangle an overhead photograph
 * covers (`ceiling.extent`, `floor.extent`), metres. Past it the photograph's
 * edge would be smeared over the rest of the surface.
 *
 * It is not slack to tighten. The ceiling's photograph covers the outline's
 * bounding box exactly, but the tools lay the floor's in whole texels from
 * the box's lowest x and highest z, so a published `floor.extent` stops up to
 * half a texel short of the box's other two sides, or runs that far past
 * them. Every room configured so far photographs its floor at 120 texels per
 * metre: half a texel is 4.17 mm, which 5 mm admits with 0.8 mm to spare.
 *
 * So 5 mm covers that half texel only for a floor photograph of at least 100
 * texels per metre (0.5 / 100 m is 5 mm). The record carries no floor
 * resolution, so this reader cannot tell a coarser photograph that is whole
 * from one that was cropped: at 60 texels per metre half a texel is 8.33 mm,
 * and a whole floor would be refused here as not covering the outline. The
 * tools must therefore never publish such a record. Their side of this is in
 * tools/surveyed-rooms/roombuild/publish.py: `floor_extent`, which lays the
 * extent, and `record_faults`, which repeats this refusal before anything is
 * published. They arrive with #452.
 *
 * 5 mm is also what a relief may reach outside its record (room-geometry.ts
 * RELIEF_BOUNDS_TOLERANCE).
 */
export const OVERHEAD_EXTENT_TOLERANCE = 0.005;
/**
 * How far a wall's height may stand above the heights its strip of the atlas
 * covers, and a flat ceiling from the tallest wall's top, metres: what a
 * relief may reach outside its record (room-geometry.ts
 * RELIEF_BOUNDS_TOLERANCE), since a wall's relief is held to the same strip.
 */
export const HEIGHT_TOLERANCE = 0.005;
/**
 * How far the atlas's row may differ from the heights its strips cover times
 * its texels per metre, in texels: the tools round a row up to a whole texel
 * (the Saloon's is exact at 1111; the Grand Hall's 1304 covers 1303.45).
 */
export const ATLAS_ROW_TOLERANCE = 1;

/** A published file's name: no folders, nothing to climb out of the room's folder with. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

const FileName = z.string().regex(FILE_NAME, "must be a plain file name (letters, digits, '.', '_' or '-', no folders)");
const ReliefId = z.string().refine(isReliefId, `must be 1 to ${String(RELIEF_ID_BYTES)} printable ASCII characters without spaces (the relief container's id field)`);
const Point = z.tuple([z.number(), z.number()]);
const Increasing = z.tuple([z.number(), z.number()]).refine(([lo, hi]) => hi > lo, "must increase ([low, high])");
const PositiveInt = z.number().int().positive();
const Texel = z.number().int().nonnegative();

const RoomSchema = z.object({
  name: z.string().min(1),
  venue: z.string().regex(SLUG, "must be a venue slug"),
  ceilingHeight: z.number().positive(),
  outline: z.array(Point).superRefine((outline, ctx) => {
    const fault = outlineFault(outline);
    if (fault !== null) ctx.addIssue({ code: "custom", message: `the outline ${fault}` });
  }),
});

/** How an overhead photograph lies over its extent: the only way the tools write one. */
export const OVERHEAD_ORIENTATION = "columns planner +x, rows from planner +z";

const Orientation = z.literal(OVERHEAD_ORIENTATION, {
  error: `must be "${OVERHEAD_ORIENTATION}" (the only orientation this reader draws)`,
});
/** The planner rectangle a photograph covers. */
const Extent = z.object({ x: Increasing, z: Increasing });

const AtlasSchema = z.object({
  size: z.tuple([PositiveInt, PositiveInt]),
  ppm: z.number().positive(),
  vRange: Increasing,
  row: PositiveInt,
  /** The atlas image at each published size, largest first. */
  files: z.array(FileName).min(1, "must name at least one atlas image"),
});

const WallSchema = z.object({
  id: z.string().min(1),
  reliefId: ReliefId,
  length: z.number().positive(),
  height: z.number().positive(),
  kind: z.enum(["solid", "partition", "screen", "open"]),
  /** Strip's top-left texel (image rows counting down), width and height. */
  atlas: z.tuple([Texel, Texel, PositiveInt, PositiveInt]),
});

const ReliefSchema = z.object({
  container: z.literal("GHR1", { error: 'must be "GHR1"' }),
  file: FileName,
  order: z.array(ReliefId),
});

const CeilingReliefSchema = z.object({
  file: FileName,
  id: ReliefId,
  /** Planner height that the relief's depth is measured down from. */
  reference: z.number(),
  heightRange: Increasing,
});

const CeilingSchema = z.object({
  extent: Extent,
  orientation: Orientation.optional(),
  /** The ceiling photograph at each published size, largest first; none for a ceiling without one. */
  files: z.array(FileName),
  relief: CeilingReliefSchema.optional(),
});

const FloorSchema = z.object({
  extent: Extent,
  orientation: Orientation.optional(),
  /** The floor photograph at each published size, largest first; none for a floor without one. */
  files: z.array(FileName),
});

const FileEntrySchema = z.object({
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256, "must be a lower-case hex SHA-256"),
});

const SurveyRecordShape = z.object({
  schemaVersion: z.literal(SURVEY_SCHEMA_VERSION),
  slug: z.string().regex(SLUG, "must be a room slug (lower-case words joined by '-')"),
  revision: z.number().int().min(1),
  captured: z.iso.date(),
  room: RoomSchema,
  atlas: AtlasSchema,
  walls: z.array(WallSchema),
  relief: ReliefSchema,
  ceiling: CeilingSchema,
  floor: FloorSchema,
  files: z.record(FileName, FileEntrySchema),
});

type Shape = z.infer<typeof SurveyRecordShape>;
type Issue = { readonly path: readonly (string | number)[]; readonly message: string };

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function stripsOverlap(a: readonly number[], b: readonly number[]): boolean {
  const [ax = 0, ay = 0, aw = 0, ah = 0] = a;
  const [bx = 0, by = 0, bw = 0, bh = 0] = b;
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Faults between the record's parts, each shape already being valid. */
function crossChecks(record: Shape): Issue[] {
  const issues: Issue[] = [];
  const outline: readonly PlanPoint[] = record.room.outline;
  const outlineValid = outlineFault(outline) === null;
  const { walls, atlas } = record;

  if (outlineValid && walls.length !== outline.length) {
    issues.push({
      path: ["walls"],
      message: `has ${String(walls.length)} walls but the outline has ${String(outline.length)} segments; there must be one wall per segment, in outline order`,
    });
  }

  // A strip is as many texels high as the heights it covers at the atlas's scale. Nothing else ties
  // `ppm` to the image: a record saying 100 for an atlas packed at 200 would pass every strip's own
  // checks and dress each wall in a quarter of its strip.
  const span = (atlas.vRange[1] - atlas.vRange[0]) * atlas.ppm;
  if (Math.abs(atlas.row - span) > ATLAS_ROW_TOLERANCE) {
    issues.push({
      path: ["atlas", "row"],
      message: `is ${String(atlas.row)} texels, but vRange [${String(atlas.vRange[0])}, ${String(atlas.vRange[1])}] at ${String(atlas.ppm)} texels per metre is ${span.toFixed(2)}: a strip's height must be the heights it covers, to within ${String(ATLAS_ROW_TOLERANCE)} texel`,
    });
  }

  for (const id of duplicates(walls.map((wall) => wall.id))) issues.push({ path: ["walls"], message: `wall id "${id}" is used twice` });
  for (const id of duplicates(walls.map((wall) => wall.reliefId))) issues.push({ path: ["walls"], message: `relief id "${id}" is used twice` });

  walls.forEach((wall, index) => {
    if (outlineValid && index < outline.length) {
      const measured = segmentLength(outline, index);
      if (Math.abs(wall.length - measured) > WALL_LENGTH_TOLERANCE + 1e-9) {
        issues.push({
          path: ["walls", index, "length"],
          message: `wall "${wall.id}" is ${String(wall.length)} m long but outline segment ${String(index)} is ${measured.toFixed(4)} m (more than ${String(WALL_LENGTH_TOLERANCE * 1000)} mm apart)`,
        });
      }
    }
    // A wall stands from the floor to its height, and its strip covers the atlas's heights: taller
    // than its strip, its top would wear whatever lies above the strip in the image.
    if (wall.height > atlas.vRange[1] + HEIGHT_TOLERANCE) {
      issues.push({
        path: ["walls", index, "height"],
        message: `wall "${wall.id}" is ${String(wall.height)} m high, but the atlas's strips cover heights up to ${String(atlas.vRange[1])} m (vRange), more than ${String(HEIGHT_TOLERANCE * 1000)} mm short of it`,
      });
    }
    const [x, y, w, h] = wall.atlas;
    if (x + w > atlas.size[0] || y + h > atlas.size[1]) {
      issues.push({
        path: ["walls", index, "atlas"],
        message: `wall "${wall.id}"'s strip [${String(x)}, ${String(y)}, ${String(w)}, ${String(h)}] leaves the ${String(atlas.size[0])} x ${String(atlas.size[1])} atlas`,
      });
    }
    if (h !== atlas.row) {
      issues.push({
        path: ["walls", index, "atlas"],
        message: `wall "${wall.id}"'s strip is ${String(h)} texels high but the atlas's row is ${String(atlas.row)}`,
      });
    }
    if (wall.length * atlas.ppm > w + 1e-6) {
      issues.push({
        path: ["walls", index, "atlas"],
        message: `wall "${wall.id}" (${String(wall.length)} m at ${String(atlas.ppm)} texels per metre) is wider than its ${String(w)}-texel strip`,
      });
    }
    for (let other = 0; other < index; other++) {
      const previous = walls[other];
      if (previous !== undefined && stripsOverlap(previous.atlas, wall.atlas)) {
        issues.push({ path: ["walls", index, "atlas"], message: `wall "${wall.id}"'s strip overlaps wall "${previous.id}"'s` });
      }
    }
  });

  // A ceiling without a relief is drawn flat at the room's ceiling height, so that height must be
  // where the walls end: higher, and a band of nothing shows above them; lower, and they stand
  // through it. A ceiling with a relief is drawn from its measured heights instead (held to
  // `heightRange` when it loads), and the room's ceiling height is then only its reference: walls
  // of several heights under a stepped or coffered ceiling are no fault.
  if (record.ceiling.relief === undefined && walls.length > 0) {
    const tallest = Math.max(...walls.map((wall) => wall.height));
    if (Math.abs(record.room.ceilingHeight - tallest) > HEIGHT_TOLERANCE) {
      issues.push({
        path: ["room", "ceilingHeight"],
        message: `is ${String(record.room.ceilingHeight)} m, but the tallest wall is ${String(tallest)} m high and the ceiling has no relief: a flat ceiling is drawn at this height, and must meet the walls' tops to within ${String(HEIGHT_TOLERANCE * 1000)} mm`,
      });
    }
  }

  const wallReliefIds = new Set(walls.map((wall) => wall.reliefId));
  const order = record.relief.order;
  const orderSet = new Set(order);
  const missing = [...wallReliefIds].filter((id) => !orderSet.has(id));
  const extra = [...orderSet].filter((id) => !wallReliefIds.has(id));
  const repeated = duplicates(order);
  if (missing.length > 0 || extra.length > 0 || repeated.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`leaves out ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`names ${extra.join(", ")}, which no wall has`);
    if (repeated.length > 0) parts.push(`repeats ${repeated.join(", ")}`);
    issues.push({ path: ["relief", "order"], message: `must list each wall's relief id exactly once; it ${parts.join(" and ")}` });
  }

  // The floor and a flat ceiling are the outline itself, wearing a photograph laid over its extent:
  // where the outline reaches past the extent the photograph's edge row or column would be smeared
  // over the rest (a floor photograph cropped to a room's main rectangle, its bays left off). A
  // larger extent is no fault. An extent that does not increase has its own fault already.
  if (outlineValid) {
    const bounds = outlineBounds(outline);
    const reach = { x: [bounds.minX, bounds.maxX], z: [bounds.minZ, bounds.maxZ] } as const;
    for (const part of ["ceiling", "floor"] as const) {
      for (const axis of ["x", "z"] as const) {
        const [low, high] = record[part].extent[axis];
        const [least, most] = reach[axis];
        if (!(high > low) || (least >= low - OVERHEAD_EXTENT_TOLERANCE && most <= high + OVERHEAD_EXTENT_TOLERANCE)) continue;
        issues.push({
          path: [part, "extent", axis],
          message: `covers ${String(low)} m to ${String(high)} m, but the outline runs from ${String(least)} m to ${String(most)} m along ${axis}, more than ${String(OVERHEAD_EXTENT_TOLERANCE * 1000)} mm outside it: the ${part}'s photograph must cover the whole outline`,
        });
      }
    }
  }

  const listed = (name: string): boolean => Object.hasOwn(record.files, name);
  const references: { readonly path: readonly (string | number)[]; readonly name: string }[] = [
    ...record.atlas.files.map((name, i) => ({ path: ["atlas", "files", i], name })),
    { path: ["relief", "file"], name: record.relief.file },
    ...record.ceiling.files.map((name, i) => ({ path: ["ceiling", "files", i], name })),
    ...record.floor.files.map((name, i) => ({ path: ["floor", "files", i], name })),
    ...(record.ceiling.relief === undefined ? [] : [{ path: ["ceiling", "relief", "file"], name: record.ceiling.relief.file }]),
  ];
  for (const reference of references) {
    if (!listed(reference.name)) issues.push({ path: reference.path, message: `names "${reference.name}", which is missing from files` });
  }

  const sizes: readonly (readonly [string, readonly string[]])[] = [
    ["atlas", record.atlas.files], ["ceiling", record.ceiling.files], ["floor", record.floor.files],
  ];
  for (const [part, names] of sizes) {
    for (const name of duplicates(names)) issues.push({ path: [part, "files"], message: `names "${name}" twice` });
    for (let i = 1; i < names.length; i++) {
      const larger = names[i - 1];
      const smaller = names[i];
      if (larger === undefined || smaller === undefined) continue;
      const before = record.files[larger]?.bytes;
      const after = record.files[smaller]?.bytes;
      if (before !== undefined && after !== undefined && after > before) {
        issues.push({
          path: [part, "files", i],
          message: `must list the largest image first, but "${smaller}" (${String(after)} bytes) follows the smaller "${larger}" (${String(before)} bytes)`,
        });
      }
    }
  }
  return issues;
}

export const SurveyRecordSchema = SurveyRecordShape.superRefine((record, ctx) => {
  for (const issue of crossChecks(record)) ctx.addIssue({ code: "custom", path: [...issue.path], message: issue.message });
});

export type SurveyRecord = z.infer<typeof SurveyRecordSchema>;
export type SurveyRoom = SurveyRecord["room"];
export type SurveyAtlas = SurveyRecord["atlas"];
export type SurveyWall = SurveyRecord["walls"][number];
export type SurveyWallKind = SurveyWall["kind"];
export type SurveyCeiling = SurveyRecord["ceiling"];
export type SurveyFloor = SurveyRecord["floor"];
/** The planner rectangle a ceiling or floor photograph covers. */
export type SurveyExtent = SurveyCeiling["extent"];

/** A survey.json that cannot be used, with every fault found. */
export class SurveyRecordError extends Error {
  readonly faults: readonly string[];

  constructor(faults: readonly string[]) {
    super(`survey.json: ${faults.join("; ")}`);
    this.name = "SurveyRecordError";
    this.faults = faults;
  }
}

function where(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "record" : path.map((part) => (typeof part === "number" ? `[${String(part)}]` : `.${String(part)}`)).join("").replace(/^\./, "");
}

/** Reads a survey.json; throws a {@link SurveyRecordError} naming each fault. */
export function parseSurveyRecord(json: unknown): SurveyRecord {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new SurveyRecordError(["is not a JSON object"]);
  const version: unknown = (json as { readonly schemaVersion?: unknown }).schemaVersion;
  if (version !== SURVEY_SCHEMA_VERSION) {
    // No advice to "republish with the current tools": tools from before #452 write version 1 and would write it
    // again. The message names the change that cures it, so it holds whichever of that and this reader lands first.
    const versionOne = version === 1
      ? " (the survey tools write version 2 from #452 on; a version 1 record has none of the room, wall heights, atlas images or floor this reader needs, so the room must be built again with tools that include #452)"
      : "";
    throw new SurveyRecordError([
      `schemaVersion is ${version === undefined ? "missing" : JSON.stringify(version)}; this reader reads version ${String(SURVEY_SCHEMA_VERSION)} only${versionOne}`,
    ]);
  }
  const result = SurveyRecordSchema.safeParse(json);
  if (result.success) return result.data;
  throw new SurveyRecordError(result.error.issues.map((issue) => `${where(issue.path)}: ${issue.message}`));
}
