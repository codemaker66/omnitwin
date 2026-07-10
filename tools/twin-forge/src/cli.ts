import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { TwinTierSchema } from "@omnitwin/types";
import { z } from "zod";
import { forgeBundle, refreshBundleManifest, type ForgeBundleResult } from "./forge.js";

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
  "refresh-manifest": { type: "boolean", default: false },
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
  const posesPath = req("poses", values.poses);
  const rawPoses = RawPosesSchema.parse(await readJson(posesPath));
  const overrides =
    values.overrides === undefined
      ? undefined
      : OverridesSchema.parse(await readJson(values.overrides));
  if (values["refresh-manifest"]) {
    const result = await refreshBundleManifest({
      rawPoses,
      outDir: req("out", values.out),
      ...(overrides === undefined ? {} : { overrides }),
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
