import { z } from "zod";

// ---------------------------------------------------------------------------
// Runtime schemas for the Met Office Site-Specific Blended Probabilistic
// Forecast (BPF) v2 API, an OGC EDR service (T-647).
//
// Sources (read 2026-10-08):
// - OpenAPI definition, version 2.0.0:
//   https://datahub.metoffice.gov.uk/downloads/api-definitions/mo-site-specific-blended-probabilistic-forecast-v2_subscriber.json
//   (sha256 8ccb6ee195411575b9712cbad6e7d62ac57329f5dc783496be1e961605825ff0).
//   It defines `/collections` as { collections: [{ id, title, links, ... }],
//   links } and leaves the instance and data bodies undefined.
// - API User Guide:
//   https://datahub.metoffice.gov.uk/docs/f/category/site-specific/type/probabilistic-forecast-feature/api-user-guide
//   It documents the data body as a CoverageJSON CoverageCollection: one
//   coverage per parameter, `domain.axes` with `t` (ISO date-times, plus
//   `bounds` pairs for period parameters), single-valued x/y/z, extra axes
//   for thresholds or realizations, and `ranges` NdArrays whose `values`
//   are flattened in `axisNames` order with `shape` the axis lengths. Its
//   OpenAPI position query ("Provides data for the nearest location as a
//   CovJson response") has no output-format parameter, so none is sent.
// - CoverageJSON (OGC 21-069r2): a coverage collection MAY carry
//   `parameters` (9.6.5); a coverage MUST carry its own when the collection
//   does not, and the parameters in scope are the coverage's, else the
//   collection's (9.6.4). The live v2 service puts them on each coverage
//   (production, 10 October: no collection-level `parameters`).
// - Instances follow OGC API - EDR Part 1 (OGC 19-086r6): { instances:
//   [{ id, extent: { temporal: { interval: [[start, end]] } }, ... }] }.
//
// Fields this API does not use are stripped, never trusted. Shapes the
// documents do not promise are optional and checked where they are used.
// ---------------------------------------------------------------------------

/** A collection's title (documented) and EDR parameter_names (OGC 19-086r6,
 *  not in the OpenAPI definition) are taken in any shape and checked by
 *  listedCollection(), so an unexpected one never fails the whole list. */
export const EdrCollectionsSchema = z.object({
  collections: z.array(z.object({
    id: z.string().min(1),
    title: z.unknown().optional(),
    parameter_names: z.unknown().optional(),
  })),
});
export type EdrCollections = z.infer<typeof EdrCollectionsSchema>;

const TemporalIntervalSchema = z.array(z.tuple([z.string().nullable(), z.string().nullable()]));

/** An instance keeps its other members (passthrough) so their names can be
 *  logged: EDR documents no issue time, and the live instance's members are
 *  how one would be found. They are described, never read. */
export const EdrInstancesSchema = z.object({
  instances: z.array(z.object({
    id: z.string().min(1),
    extent: z.object({
      temporal: z.object({ interval: TemporalIntervalSchema.optional() }).passthrough().optional(),
    }).passthrough().optional(),
  }).passthrough()),
});
export type EdrInstances = z.infer<typeof EdrInstancesSchema>;

const AxisValueSchema = z.union([z.string(), z.number()]);

const AxisSchema = z.object({
  values: z.array(AxisValueSchema).min(1).optional(),
  bounds: z.array(AxisValueSchema).optional(),
});

const NdArraySchema = z.object({
  type: z.literal("NdArray"),
  axisNames: z.array(z.string().min(1)).min(1),
  shape: z.array(z.number().int().nonnegative()).min(1),
  values: z.array(z.number().nullable()),
}).superRefine((array, ctx) => {
  if (array.shape.length !== array.axisNames.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shape"], message: "shape and axisNames differ in length" });
    return;
  }
  const size = array.shape.reduce((product, n) => product * n, 1);
  if (size !== array.values.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values"], message: "values length is not the product of shape" });
  }
});
export type NdArray = z.infer<typeof NdArraySchema>;

/** CoverageJSON unit symbols are either a string or { value, type }. */
const UnitSchema = z.object({
  symbol: z.union([z.string(), z.object({ value: z.string() })]).optional(),
});

const ParameterSchema = z.object({ unit: UnitSchema.optional() });
const ParametersSchema = z.record(ParameterSchema);

const CoverageSchema = z.object({
  type: z.literal("Coverage"),
  domain: z.object({ axes: z.record(AxisSchema) }),
  parameters: ParametersSchema.optional(),
  ranges: z.record(NdArraySchema),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const CoverageCollectionSchema = z.object({
  type: z.literal("CoverageCollection"),
  parameters: ParametersSchema.optional(),
  coverages: z.array(CoverageSchema).min(1),
});
export type CoverageCollection = z.infer<typeof CoverageCollectionSchema>;

/** The unit symbol declared for a parameter, if any: from the parameters in
 *  scope for the coverage holding its range, which are the coverage's own
 *  when it has them, else the collection's (CoverageJSON 9.6.4). */
export function unitSymbol(collection: CoverageCollection, key: string): string | null {
  const coverage = collection.coverages.find((candidate) => Object.hasOwn(candidate.ranges, key));
  const scope = coverage?.parameters ?? collection.parameters;
  const symbol = scope?.[key]?.unit?.symbol;
  if (symbol === undefined) return null;
  return typeof symbol === "string" ? symbol : symbol.value;
}

/** Zod issue paths, for logs that must not carry payloads. */
export function issuePaths(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

// ---------------------------------------------------------------------------
// A body that fails its schema is described for the log by its structure
// alone: member names, array lengths, and the type strings CoverageJSON and
// GeoJSON use ("type", "domainType", "dataType"). Breadth first, four levels
// deep, at most 20 names per object and 30 lines of 200 printable
// characters. No other value is written: no numbers, no text, no links.
// ---------------------------------------------------------------------------

const STRUCTURE_LINES = 30;
const STRUCTURE_NAMES = 20;
const STRUCTURE_DEPTH = 4;
const STRUCTURE_LINE_CHARS = 200;
const STRUCTURE_TEXT_CHARS = 60;
const TYPE_MEMBERS: ReadonlySet<string> = new Set(["type", "domainType", "dataType"]);

function printable(text: string): string {
  return text.replace(/[^ -~]+/gu, "?").slice(0, STRUCTURE_TEXT_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The structure of a JSON value, one line per object or array. */
export function describeStructure(body: unknown): string[] {
  const lines: string[] = [];
  const queue: { readonly value: unknown; readonly path: string; readonly depth: number }[] = [{ value: body, path: "", depth: 0 }];
  for (let next = queue.shift(); next !== undefined && lines.length < STRUCTURE_LINES; next = queue.shift()) {
    const { value, path, depth } = next;
    const name = path === "" ? "(root)" : path;
    if (Array.isArray(value)) {
      lines.push(`${name}: array(${String(value.length)})`);
      if (value.length > 0 && depth < STRUCTURE_DEPTH) queue.push({ value: value[0], path: `${path}[0]`, depth: depth + 1 });
    } else if (isRecord(value)) {
      const keys = Object.keys(value).sort();
      const shown = keys.slice(0, STRUCTURE_NAMES);
      const more = keys.length - shown.length;
      lines.push(`${name} keys: ${shown.map(printable).join(", ")}${more > 0 ? ` and ${String(more)} more` : ""}`);
      for (const key of shown) {
        const child = value[key];
        const childPath = path === "" ? printable(key) : `${path}.${printable(key)}`;
        if (TYPE_MEMBERS.has(key) && typeof child === "string") lines.push(`${childPath} = ${printable(child)}`);
        else if (typeof child === "object" && child !== null && depth < STRUCTURE_DEPTH) queue.push({ value: child, path: childPath, depth: depth + 1 });
      }
    } else {
      lines.push(`${name}: ${value === null ? "null" : typeof value}`);
    }
  }
  return lines.slice(0, STRUCTURE_LINES).map((line) => line.slice(0, STRUCTURE_LINE_CHARS));
}
