import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { TwinTierSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  forgeBundle,
  refreshBundleManifest,
  replaceBundleMesh,
  type ForgeBundleResult,
} from "./forge.js";

const CLI_OPTIONS = {
  cubemaps: { type: "string" },
  equirects: { type: "string" },
  poses: { type: "string" },
  out: { type: "string" },
  venue: { type: "string" },
  name: { type: "string" },
  tier: { type: "string", default: "ops-grade-2cm" },
  overrides: { type: "string" },
  mesh: { type: "string" },
  "replace-mesh": { type: "string" },
  "refresh-manifest": { type: "boolean", default: false },
  // Declare that this capture really is disconnected — two buildings, an
  // unreachable wing. Without it a split walk graph fails the forge, because
  // a walkthrough whose halves cannot reach one another strands every visitor
  // who lands on the wrong side and reports nothing.
  "allow-disconnected": { type: "boolean", default: false },
} as const;

const CanonicalPoseIndexSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const FiniteNumberSchema = z.number().finite();
const RawPosesSchema = z
  .record(
    CanonicalPoseIndexSchema,
    z
      .object({
        rotation: z.tuple([
          FiniteNumberSchema,
          FiniteNumberSchema,
          FiniteNumberSchema,
          FiniteNumberSchema,
        ]),
        translation: z.tuple([FiniteNumberSchema, FiniteNumberSchema, FiniteNumberSchema]),
      })
      .strict(),
  )
  .refine((poses) => Object.keys(poses).length > 0, "poses file must contain at least one scan");

const ScanIdSchema = z.string().regex(/^scan_\d{3}$/);
const OverridePairSchema = z
  .tuple([ScanIdSchema, ScanIdSchema])
  .refine(([a, b]) => a !== b, "navigation overrides cannot reference the same scan twice");
const OverridesSchema = z
  .object({
    // JSON cannot carry comments, and an override file is the one artifact
    // that must never travel without its reasoning: each entry is a human
    // asserting two viewpoints are joined in the real building, and the next
    // reader needs to know what was looked at. `$comment` is the JSON-Schema
    // convention for exactly this. Ignored by the builder; admitted here so
    // strict mode does not reject the rationale living beside the data.
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    add: z.array(OverridePairSchema).optional(),
    remove: z.array(OverridePairSchema).optional(),
  })
  .strict();

function req(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") throw new Error(`--${name} is required`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error: unknown) {
    throw new Error(`cannot read JSON input ${path}`, { cause: error });
  }
}

function parseCliArgs(args: readonly string[]) {
  return parseArgs({
    args,
    options: CLI_OPTIONS,
    strict: true,
    allowPositionals: false,
  }).values;
}

function parseTier(value: string | undefined) {
  const result = TwinTierSchema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    `--tier must be one of ${TwinTierSchema.options.join(", ")} (got "${String(value)}")`,
  );
}

function reportProgress(done: number, total: number): void {
  if (done % 60 === 0 || done === total) {
    process.stdout.write(`tiles ${String(done)}/${String(total)}\n`);
  }
}

function writeSummary(result: ForgeBundleResult): void {
  if (result.manifest.mesh !== undefined) {
    process.stdout.write(
      `mesh: ${String(result.manifest.mesh.bytes)} bytes from ${result.manifest.mesh.sourceName}\n`,
    );
  }
  process.stdout.write(
    `forge complete: ${String(result.manifest.nodes.length)} nodes, ` +
      `${String(result.manifest.edges.length)} edges, ${String(result.report.written)} tiles written, ` +
      `${String(result.report.skipped)} skipped\n`,
  );
}

async function main(args: readonly string[]): Promise<void> {
  const values = parseCliArgs(args);
  if (values["replace-mesh"] !== undefined) {
    if (values["refresh-manifest"] || values.mesh !== undefined) {
      throw new Error("--replace-mesh cannot be combined with --refresh-manifest or --mesh");
    }
    const result = await replaceBundleMesh({
      outDir: req("out", values.out),
      preparedMeshPath: req("replace-mesh", values["replace-mesh"]),
    });
    writeSummary(result);
    return;
  }
  const posesPath = req("poses", values.poses);
  const rawPoses = RawPosesSchema.parse(await readJson(posesPath));
  const overrides =
    values.overrides === undefined
      ? undefined
      : OverridesSchema.parse(await readJson(values.overrides));
  const allowDisconnected = values["allow-disconnected"];
  if (values["refresh-manifest"]) {
    const result = await refreshBundleManifest({
      rawPoses,
      outDir: req("out", values.out),
      ...(overrides === undefined ? {} : { overrides }),
      ...(allowDisconnected ? { allowDisconnected } : {}),
    });
    writeSummary(result);
    return;
  }

  const result = await forgeBundle({
    rawPoses,
    outDir: req("out", values.out),
    venueSlug: req("venue", values.venue),
    name: req("name", values.name),
    tier: parseTier(values.tier),
    ...(values.cubemaps === undefined ? {} : { cubemapsDir: values.cubemaps }),
    ...(values.equirects === undefined ? {} : { equirectDir: values.equirects }),
    ...(values.mesh === undefined ? {} : { meshPath: values.mesh }),
    ...(overrides === undefined ? {} : { overrides }),
    ...(allowDisconnected ? { allowDisconnected } : {}),
    protectedInputPaths: [
      posesPath,
      ...(values.overrides === undefined ? [] : [values.overrides]),
    ],
    onProgress: reportProgress,
  });
  writeSummary(result);
}

try {
  await main(process.argv.slice(2));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`forge failed: ${message}\n`);
  process.exitCode = 1;
}
