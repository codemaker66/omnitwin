// ---------------------------------------------------------------------------
// A surveyed room's record: survey.json, schema version 2
//
// tools/surveyed-rooms publishes survey.json beside a room's photographs and
// reliefs (roombuild/publish.py). Version 2 is version 1 with a `room` block:
// the room's name, venue, ceiling height and measured outline. Everything a
// room-driven renderer needs to place the published files comes from here, so
// the record is checked as a whole before anything is drawn from it: the
// outline frames a room, each wall matches its segment, the atlas strips fit
// and do not overlap, the relief order names exactly the walls, and every file
// the record points at is one it lists.
//
// Keys the web does not use (tools, glassScan, openings, linkedInputs,
// configSha256, methodRevision, the atlas's packing, the relief's meshing
// parameters) may be present and are dropped.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { isReliefId, RELIEF_ID_BYTES } from "./relief-container.js";
import { outlineFault, segmentLength, type PlanPoint } from "./room-frame.js";

export const SURVEY_SCHEMA_VERSION = 2;
/** How far a wall's recorded length may differ from its outline segment, metres. */
export const WALL_LENGTH_TOLERANCE = 0.002;

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

const AtlasSchema = z.object({
  size: z.tuple([PositiveInt, PositiveInt]),
  ppm: z.number().positive(),
  vRange: Increasing,
  row: PositiveInt,
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
  extent: z.object({ x: Increasing, z: Increasing }),
  files: z.array(FileName),
  relief: CeilingReliefSchema.optional(),
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
  floor: z.object({ files: z.array(FileName) }),
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

  const listed = (name: string): boolean => Object.hasOwn(record.files, name);
  const references: { readonly path: readonly (string | number)[]; readonly name: string }[] = [
    { path: ["relief", "file"], name: record.relief.file },
    ...record.ceiling.files.map((name, i) => ({ path: ["ceiling", "files", i], name })),
    ...record.floor.files.map((name, i) => ({ path: ["floor", "files", i], name })),
    ...(record.ceiling.relief === undefined ? [] : [{ path: ["ceiling", "relief", "file"], name: record.ceiling.relief.file }]),
  ];
  for (const reference of references) {
    if (!listed(reference.name)) issues.push({ path: reference.path, message: `names "${reference.name}", which is missing from files` });
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
    throw new SurveyRecordError([
      `schemaVersion is ${version === undefined ? "missing" : JSON.stringify(version)}; this reader reads version ${String(SURVEY_SCHEMA_VERSION)} (republish the room with the current tools)`,
    ]);
  }
  const result = SurveyRecordSchema.safeParse(json);
  if (result.success) return result.data;
  throw new SurveyRecordError(result.error.issues.map((issue) => `${where(issue.path)}: ${issue.message}`));
}
