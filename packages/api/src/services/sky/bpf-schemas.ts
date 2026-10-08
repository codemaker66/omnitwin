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
//   are flattened in `axisNames` order with `shape` the axis lengths.
// - Instances follow OGC API - EDR Part 1 (OGC 19-086r6): { instances:
//   [{ id, extent: { temporal: { interval: [[start, end]] } }, ... }] }.
//
// Fields this API does not use are stripped, never trusted. Shapes the
// documents do not promise are optional and checked where they are used.
// ---------------------------------------------------------------------------

export const EdrCollectionsSchema = z.object({
  collections: z.array(z.object({ id: z.string().min(1) })),
});
export type EdrCollections = z.infer<typeof EdrCollectionsSchema>;

const TemporalIntervalSchema = z.array(z.tuple([z.string().nullable(), z.string().nullable()]));

export const EdrInstancesSchema = z.object({
  instances: z.array(z.object({
    id: z.string().min(1),
    extent: z.object({
      temporal: z.object({ interval: TemporalIntervalSchema.optional() }).optional(),
    }).optional(),
  })),
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

const CoverageSchema = z.object({
  type: z.literal("Coverage"),
  domain: z.object({ axes: z.record(AxisSchema) }),
  ranges: z.record(NdArraySchema),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const CoverageCollectionSchema = z.object({
  type: z.literal("CoverageCollection"),
  parameters: z.record(ParameterSchema),
  coverages: z.array(CoverageSchema).min(1),
});
export type CoverageCollection = z.infer<typeof CoverageCollectionSchema>;

/** The unit symbol a collection declares for a parameter, if any. */
export function unitSymbol(collection: CoverageCollection, key: string): string | null {
  const symbol = collection.parameters[key]?.unit?.symbol;
  if (symbol === undefined) return null;
  return typeof symbol === "string" ? symbol : symbol.value;
}

/** Zod issue paths, for logs that must not carry payloads. */
export function issuePaths(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
