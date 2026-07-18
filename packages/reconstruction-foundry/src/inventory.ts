import { extname } from "node:path";
import { listSafeBundleFiles, type SafeBundleFile } from "./path-safety.js";
import { sha256RegularFile } from "./hash.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_MAX_FILE_COUNT = 4_096;
export const FOUNDRY_MAX_FILE_BYTES = 512 * 1024 * 1024;
export const FOUNDRY_MAX_BUNDLE_BYTES = 1024 * 1024 * 1024;

export type FoundryMediaKind = "manifest" | "webp" | "glb";

export interface FoundryInventoryFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaKind: FoundryMediaKind;
}

export interface FoundryBundleInventory {
  readonly root: string;
  readonly files: readonly FoundryInventoryFile[];
  readonly totalBytes: number;
}

function mediaKindFor(file: SafeBundleFile): FoundryMediaKind {
  if (file.relativePath === "manifest.json") return "manifest";
  const extension = extname(file.relativePath).toLowerCase();
  if (extension === ".webp") return "webp";
  if (extension === ".glb") return "glb";
  throw new FoundryIntegrityError(
    "UNSUPPORTED_BUNDLE_FILE",
    `Twin release contains an unsupported file: ${file.relativePath}`,
  );
}

export async function inventoryTwinBundle(root: string): Promise<FoundryBundleInventory> {
  const safeFiles = await listSafeBundleFiles(root);
  if (safeFiles.length === 0 || safeFiles.length > FOUNDRY_MAX_FILE_COUNT) {
    throw new FoundryIntegrityError(
      "BUNDLE_FILE_COUNT_OUT_OF_BOUNDS",
      `Twin bundle must contain between 1 and ${String(FOUNDRY_MAX_FILE_COUNT)} files.`,
    );
  }

  const files: FoundryInventoryFile[] = [];
  let totalBytes = 0;
  for (const file of safeFiles) {
    const digest = await sha256RegularFile(file.absolutePath);
    if (digest.sizeBytes <= 0 || digest.sizeBytes > FOUNDRY_MAX_FILE_BYTES) {
      throw new FoundryIntegrityError(
        "BUNDLE_FILE_SIZE_OUT_OF_BOUNDS",
        `Twin bundle file is empty or too large: ${file.relativePath}`,
      );
    }
    totalBytes += digest.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > FOUNDRY_MAX_BUNDLE_BYTES) {
      throw new FoundryIntegrityError(
        "BUNDLE_SIZE_OUT_OF_BOUNDS",
        `Twin bundle exceeds ${String(FOUNDRY_MAX_BUNDLE_BYTES)} bytes.`,
      );
    }
    files.push({
      path: file.relativePath,
      sha256: digest.sha256,
      sizeBytes: digest.sizeBytes,
      mediaKind: mediaKindFor(file),
    });
  }

  return { root, files, totalBytes };
}

export function inventoryFile(
  inventory: FoundryBundleInventory,
  relativePath: string,
): FoundryInventoryFile {
  const file = inventory.files.find((entry) => entry.path === relativePath);
  if (file === undefined) {
    throw new FoundryIntegrityError("BUNDLE_FILE_MISSING", `Twin bundle file is missing: ${relativePath}`);
  }
  return file;
}
