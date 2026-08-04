import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  TWIN_EQUIRECT_LODS,
  TWIN_FACES,
  TWIN_LODS,
  TwinManifestSchema,
  twinEquirectPath,
  twinTilePath,
  type TwinManifest,
} from "@omnitwin/types";
import { hashBundle } from "./hashes.js";

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSamePaths(
  expectedPaths: readonly string[],
  actualPaths: readonly string[],
  label: string,
): void {
  const expected = sorted(expectedPaths);
  const actual = sorted(actualPaths);
  const missing = expected.filter((path) => !actual.includes(path));
  const unexpected = actual.filter((path) => !expected.includes(path));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} does not match the manifest` +
        (missing.length === 0 ? "" : `; missing: ${missing.join(", ")}`) +
        (unexpected.length === 0 ? "" : `; unexpected: ${unexpected.join(", ")}`),
    );
  }
}

/** Every non-manifest file the typed twin descriptor promises to publish. */
export function expectedContentPaths(manifest: TwinManifest): string[] {
  const paths: string[] = [];
  for (const node of manifest.nodes) {
    if (manifest.imagery === "equirect") {
      for (const lod of TWIN_EQUIRECT_LODS) {
        paths.push(twinEquirectPath(node.id, lod));
      }
    } else {
      for (const face of TWIN_FACES) {
        for (const lod of TWIN_LODS) {
          paths.push(twinTilePath(node.id, face, lod));
        }
      }
    }
  }
  if (manifest.mesh !== undefined) {
    paths.push(manifest.mesh.path);
  }
  return sorted(paths);
}

/**
 * Hash an unpublished staging directory only after its exact file set is
 * complete, then return a schema-validated immutable descriptor.
 */
export async function withVerifiedContentHashes(
  outDir: string,
  manifest: TwinManifest,
): Promise<TwinManifest> {
  const hashes = await hashBundle(outDir);
  assertSamePaths(expectedContentPaths(manifest), Object.keys(hashes), "staged bundle files");
  return TwinManifestSchema.parse({ ...manifest, contentHashes: hashes });
}

/** Recompute every digest and mesh byte count before the stage is promoted. */
export async function verifyBundleContent(outDir: string, manifest: TwinManifest): Promise<void> {
  if (manifest.contentHashes === undefined) {
    throw new Error("manifest must declare contentHashes before promotion");
  }
  const actualHashes = await hashBundle(outDir);
  const expectedPaths = expectedContentPaths(manifest);
  assertSamePaths(expectedPaths, Object.keys(actualHashes), "bundle files");
  assertSamePaths(expectedPaths, Object.keys(manifest.contentHashes), "manifest contentHashes");

  for (const path of expectedPaths) {
    if (actualHashes[path] !== manifest.contentHashes[path]) {
      throw new Error(`SHA-256 mismatch for ${path}`);
    }
  }

  if (manifest.mesh !== undefined) {
    const meshBytes = (await stat(join(outDir, manifest.mesh.path))).size;
    if (meshBytes !== manifest.mesh.bytes) {
      throw new Error(
        `mesh byte count mismatch: manifest=${String(manifest.mesh.bytes)} actual=${String(meshBytes)}`,
      );
    }
  }
}
