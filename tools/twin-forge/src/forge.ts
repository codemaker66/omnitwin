import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  lstat,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { TWIN_FACES, TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import { buildManifest, type RawPoses } from "./build-manifest.js";
import {
  expectedContentPaths,
  verifyBundleContent,
  withVerifiedContentHashes,
} from "./bundle-integrity.js";
import { convertEquirectTiles } from "./equirect-tiles.js";
import { listBundleFiles } from "./hashes.js";
import { optimizeMesh } from "./mesh.js";
import type { NavGraphOptions } from "./nav-graph.js";
import { assertSourceFiles } from "./source-preflight.js";
import { convertTiles } from "./tiles.js";

/** Program spec §6 Phase 2: optimized dollhouse GLB must stay ≤ 8 MiB. */
export const MESH_BUDGET_BYTES = 8 * 1024 * 1024;

export interface ForgeBundleOptions {
  readonly cubemapsDir?: string;
  readonly equirectDir?: string;
  readonly outDir: string;
  readonly rawPoses: RawPoses;
  readonly venueSlug: string;
  readonly name: string;
  readonly tier: TwinManifest["tier"];
  readonly overrides?: NavGraphOptions["overrides"];
  readonly meshPath?: string;
  readonly generatedAt?: string;
  readonly protectedInputPaths?: readonly string[];
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ForgeBundleResult {
  readonly manifest: TwinManifest;
  readonly report: { readonly written: number; readonly skipped: number };
}

export interface RefreshManifestOptions {
  readonly outDir: string;
  readonly rawPoses: RawPoses;
  readonly overrides?: NavGraphOptions["overrides"];
  readonly generatedAt?: string;
}

export interface ReplaceBundleMeshOptions {
  readonly outDir: string;
  /** Final, already-reviewed GLB. This path is copied byte-for-byte. */
  readonly preparedMeshPath: string;
  readonly generatedAt?: string;
}

export function assertMeshBudget(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`optimized mesh byte count must be a positive safe integer (got ${String(bytes)})`);
  }
  if (bytes > MESH_BUDGET_BYTES) {
    throw new Error(
      `optimized mesh is ${String(bytes)} bytes; the hard publishing budget is 8 MiB (${String(MESH_BUDGET_BYTES)} bytes)`,
    );
  }
}

function assertNoUnexpectedPaths(
  expectedPaths: readonly string[],
  actualPaths: readonly string[],
): void {
  const expected = new Set(expectedPaths);
  const unexpected = actualPaths
    .filter((path) => !expected.has(path))
    .sort((a, b) => a.localeCompare(b));
  if (unexpected.length > 0) {
    throw new Error(
      `Refusing to replace a twin directory containing unexpected files: ${unexpected.join(", ")}`,
    );
  }
}

async function parsePersistedManifest(path: string): Promise<TwinManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error: unknown) {
    throw new Error(`cannot read twin manifest at ${path}`, { cause: error });
  }
  return TwinManifestSchema.parse(raw);
}

async function assertReplaceableOutput(outDir: string, venueSlug: string): Promise<void> {
  if (!existsSync(outDir)) return;
  const info = await lstat(outDir);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Refusing to replace non-directory output ${outDir}`);
  }
  const actualPaths = await listBundleFiles(outDir);
  if (actualPaths.length === 0) return;
  if (!actualPaths.includes("manifest.json")) {
    throw new Error(`Refusing to replace non-bundle directory ${outDir}: manifest.json is absent`);
  }
  const existing = await parsePersistedManifest(join(outDir, "manifest.json"));
  if (existing.venueSlug !== venueSlug) {
    throw new Error(
      `Refusing to replace ${existing.venueSlug} bundle with ${venueSlug} at the same output path`,
    );
  }
  // Missing expected entries are safe to repair. Unexpected entries are not
  // deleted because they may be operator data outside the bundle contract.
  assertNoUnexpectedPaths([...expectedContentPaths(existing), "manifest.json"], actualPaths);
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const rel = relative(resolve(parentPath), resolve(candidatePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertOutputDoesNotContainInputs(outDir: string, inputPaths: readonly string[]): void {
  const nested = inputPaths.filter((inputPath) => isWithin(outDir, inputPath));
  if (nested.length > 0) {
    throw new Error(
      `output directory must not contain forge inputs: ${nested.map((path) => resolve(path)).join(", ")}`,
    );
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"]);

export function isRetryableRenameError(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && RETRYABLE_RENAME_CODES.has(String(error.code));
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  const attempts = process.platform === "win32" ? 8 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error: unknown) {
      const shouldRetry = attempt + 1 < attempts && isRetryableRenameError(error);
      if (!shouldRetry) throw error;
      await delay(Math.min(1000, 50 * 2 ** attempt));
    }
  }
}

async function promoteStage(stageDir: string, outDir: string): Promise<void> {
  const previousDir = `${outDir}.forge-previous-${randomUUID()}`;
  const hadPrevious = existsSync(outDir);
  if (hadPrevious) {
    await renameWithRetry(outDir, previousDir);
  }

  try {
    await renameWithRetry(stageDir, outDir);
  } catch (promotionError: unknown) {
    if (hadPrevious) {
      try {
        await renameWithRetry(previousDir, outDir);
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [asError(promotionError), asError(rollbackError)],
          `bundle promotion and rollback both failed; previous bundle remains at ${previousDir}`,
        );
      }
    }
    throw promotionError;
  }

  if (hadPrevious) {
    try {
      await rm(previousDir, { recursive: true });
    } catch (error: unknown) {
      throw new Error(
        `bundle was promoted successfully, but previous bundle cleanup failed at ${previousDir}`,
        { cause: error },
      );
    }
  }
}

async function removeFailedStage(stageDir: string, originalError: unknown): Promise<never> {
  try {
    await rm(stageDir, { recursive: true, force: true });
  } catch (cleanupError: unknown) {
    throw new AggregateError(
      [asError(originalError), asError(cleanupError)],
      `forge failed and staging cleanup also failed at ${stageDir}`,
    );
  }
  throw originalError;
}

interface CopiedBundleStage {
  readonly rootDir: string;
  readonly bundleDir: string;
}

/**
 * Copy a published bundle into a fresh child of a unique sibling directory.
 * Node's `cp` requires the destination itself not to exist when
 * `errorOnExist` is enabled on POSIX, while Windows permits an existing empty
 * destination. Keeping the unique parent and copying into its absent child
 * gives both platforms the same semantics and keeps promotion on one volume.
 */
async function createCopiedBundleStage(outDir: string): Promise<CopiedBundleStage> {
  const rootDir = await mkdtemp(join(dirname(outDir), `.${basename(outDir)}.forge-stage-`));
  const bundleDir = join(rootDir, "bundle");
  try {
    await cp(outDir, bundleDir, { recursive: true, force: false, errorOnExist: true });
    return { rootDir, bundleDir };
  } catch (error: unknown) {
    return removeFailedStage(rootDir, error);
  }
}

function imagerySourcePaths(
  imagery: TwinManifest["imagery"],
  nodeIds: readonly string[],
): string[] {
  if (imagery === "equirect") {
    return nodeIds.flatMap((nodeId) => [`${nodeId}.jpg`, `${nodeId}_8192.jpg`]);
  }
  return nodeIds.flatMap((nodeId) => TWIN_FACES.map((face) => `${nodeId}_${face}.jpg`));
}

interface PreparedForge {
  readonly outDir: string;
  readonly sourceDir: string;
  readonly imagery: TwinManifest["imagery"];
  readonly generatedAt: string;
  readonly nodeIds: readonly string[];
}

async function prepareForge(options: ForgeBundleOptions): Promise<PreparedForge> {
  const hasCubemaps = options.cubemapsDir !== undefined;
  const hasEquirects = options.equirectDir !== undefined;
  if (hasCubemaps === hasEquirects) {
    throw new Error("provide exactly one of cubemapsDir or equirectDir");
  }

  const outDir = resolve(options.outDir);
  if (dirname(outDir) === outDir) {
    throw new Error("forge output cannot be a filesystem root");
  }
  const imagery = hasEquirects ? "equirect" : "cube-faces";
  const sourceDir = resolve(options.equirectDir ?? options.cubemapsDir ?? "");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const previewManifest = buildManifest(options.rawPoses, {
    venueSlug: options.venueSlug,
    name: options.name,
    tier: options.tier,
    generatedAt,
    nav: { overrides: options.overrides },
    imagery,
  });
  const nodeIds = previewManifest.nodes.map(({ id }) => id);
  const inputPaths = [
    sourceDir,
    ...(options.meshPath === undefined ? [] : [resolve(options.meshPath)]),
    ...(options.protectedInputPaths ?? []),
  ];
  assertOutputDoesNotContainInputs(outDir, inputPaths);
  await assertReplaceableOutput(outDir, options.venueSlug);
  await assertSourceFiles(
    sourceDir,
    imagerySourcePaths(imagery, nodeIds),
    imagery === "equirect" ? "equirect" : "cubemap",
  );
  if (options.meshPath !== undefined) {
    await assertSourceFiles(dirname(options.meshPath), [basename(options.meshPath)], "mesh");
  }
  return { outDir, sourceDir, imagery, generatedAt, nodeIds };
}

async function buildStagedBundle(
  options: ForgeBundleOptions,
  prepared: PreparedForge,
  stageDir: string,
): Promise<ForgeBundleResult> {
  const meshResult =
    options.meshPath === undefined ? undefined : await optimizeMesh(options.meshPath, stageDir);
  if (meshResult !== undefined) {
    assertMeshBudget(meshResult.bytes);
  }

  const manifest = buildManifest(options.rawPoses, {
    venueSlug: options.venueSlug,
    name: options.name,
    tier: options.tier,
    generatedAt: prepared.generatedAt,
    nav: { overrides: options.overrides },
    imagery: prepared.imagery,
    ...(meshResult === undefined
      ? {}
      : {
          mesh: {
            path: "mesh/dollhouse.glb" as const,
            bytes: meshResult.bytes,
            sourceName: meshResult.sourceName,
          },
        }),
  });
  const report =
    prepared.imagery === "equirect"
      ? await convertEquirectTiles(
          prepared.sourceDir,
          stageDir,
          prepared.nodeIds,
          options.onProgress,
        )
      : await convertTiles(prepared.sourceDir, stageDir, prepared.nodeIds, options.onProgress);
  const finalized = await withVerifiedContentHashes(stageDir, manifest);
  await writeFile(join(stageDir, "manifest.json"), `${JSON.stringify(finalized, null, 2)}\n`);
  const persisted = await parsePersistedManifest(join(stageDir, "manifest.json"));
  await verifyBundleContent(stageDir, persisted);
  return { manifest: persisted, report };
}

async function promoteRefreshedStage(
  stageDir: string,
  outDir: string,
  manifest: TwinManifest,
): Promise<TwinManifest> {
  const finalized = await withVerifiedContentHashes(stageDir, manifest);
  await writeFile(join(stageDir, "manifest.json"), `${JSON.stringify(finalized, null, 2)}\n`);
  const persisted = await parsePersistedManifest(join(stageDir, "manifest.json"));
  await verifyBundleContent(stageDir, persisted);
  await assertReplaceableOutput(outDir, persisted.venueSlug);
  await promoteStage(stageDir, outDir);
  return persisted;
}

function refreshedTileReport(manifest: TwinManifest): ForgeBundleResult["report"] {
  const meshCount = manifest.mesh === undefined ? 0 : 1;
  return { written: 0, skipped: expectedContentPaths(manifest).length - meshCount };
}

/** Build into an isolated sibling directory, verify it, then promote by rename. */
export async function forgeBundle(options: ForgeBundleOptions): Promise<ForgeBundleResult> {
  const prepared = await prepareForge(options);
  await mkdir(dirname(prepared.outDir), { recursive: true });
  const stageDir = await mkdtemp(
    join(dirname(prepared.outDir), `.${basename(prepared.outDir)}.forge-stage-`),
  );
  try {
    const result = await buildStagedBundle(options, prepared, stageDir);
    // Recheck the destination after the potentially long conversion so a
    // non-bundle directory introduced mid-run is never deleted.
    await assertReplaceableOutput(prepared.outDir, options.venueSlug);
    await promoteStage(stageDir, prepared.outDir);
    return result;
  } catch (error: unknown) {
    return removeFailedStage(stageDir, error);
  }
}

/**
 * Rebuild only the descriptor for an already complete bundle. This is the
 * safe repair path for navigation/floor metadata changes: copy the published
 * bundle into staging, recompute every content hash, schema-validate, and use
 * the same directory promotion/rollback path as a full image forge.
 */
export async function refreshBundleManifest(
  options: RefreshManifestOptions,
): Promise<ForgeBundleResult> {
  const outDir = resolve(options.outDir);
  if (!existsSync(outDir)) {
    throw new Error(`cannot refresh absent twin bundle ${outDir}`);
  }
  const existing = await parsePersistedManifest(join(outDir, "manifest.json"));
  await assertReplaceableOutput(outDir, existing.venueSlug);

  const stage = await createCopiedBundleStage(outDir);
  try {
    const manifest = buildManifest(options.rawPoses, {
      venueSlug: existing.venueSlug,
      name: existing.name,
      tier: existing.tier,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      nav: { overrides: options.overrides },
      imagery: existing.imagery,
      ...(existing.mesh === undefined ? {} : { mesh: existing.mesh }),
    });
    const persisted = await promoteRefreshedStage(stage.bundleDir, outDir, manifest);
    await rm(stage.rootDir, { recursive: true, force: true });
    return { manifest: persisted, report: refreshedTileReport(persisted) };
  } catch (error: unknown) {
    return removeFailedStage(stage.rootDir, error);
  }
}

/**
 * Atomically replace only an existing bundle's prepared dollhouse GLB.
 * Unlike full forging this performs no geometry or texture transform: the
 * reviewed input is copied byte-for-byte, all existing manifest metadata is
 * preserved, hashes are rebuilt, and the complete staged bundle is verified
 * before rename promotion.
 */
export async function replaceBundleMesh(
  options: ReplaceBundleMeshOptions,
): Promise<ForgeBundleResult> {
  const outDir = resolve(options.outDir);
  const preparedMeshPath = resolve(options.preparedMeshPath);
  if (!existsSync(outDir)) {
    throw new Error(`cannot replace mesh in absent twin bundle ${outDir}`);
  }
  if (isWithin(outDir, preparedMeshPath)) {
    throw new Error("prepared mesh must be outside the published twin bundle");
  }
  await assertSourceFiles(
    dirname(preparedMeshPath),
    [basename(preparedMeshPath)],
    "prepared mesh",
  );

  const existing = await parsePersistedManifest(join(outDir, "manifest.json"));
  await assertReplaceableOutput(outDir, existing.venueSlug);
  await verifyBundleContent(outDir, existing);

  const stage = await createCopiedBundleStage(outDir);
  try {
    await verifyBundleContent(stage.bundleDir, existing);
    const stagedMeshDir = join(stage.bundleDir, "mesh");
    const stagedMeshPath = join(stagedMeshDir, "dollhouse.glb");
    await mkdir(stagedMeshDir, { recursive: true });
    await copyFile(preparedMeshPath, stagedMeshPath);
    const bytes = (await stat(stagedMeshPath)).size;
    assertMeshBudget(bytes);

    const manifest = TwinManifestSchema.parse({
      ...existing,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      mesh: {
        path: "mesh/dollhouse.glb",
        bytes,
        sourceName: basename(preparedMeshPath),
      },
    });
    const persisted = await promoteRefreshedStage(stage.bundleDir, outDir, manifest);
    await rm(stage.rootDir, { recursive: true, force: true });
    return { manifest: persisted, report: refreshedTileReport(persisted) };
  } catch (error: unknown) {
    return removeFailedStage(stage.rootDir, error);
  }
}
