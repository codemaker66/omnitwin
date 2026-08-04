import { stat } from "node:fs/promises";
import { join } from "node:path";

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) {
    return error.code;
  }
  return undefined;
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw new Error(`Cannot inspect forge source ${path}`, { cause: error });
  }
}

/**
 * Fail before conversion starts unless every file declared by the capture is
 * present as a regular file. This prevents a valid-looking partial bundle.
 */
export async function assertSourceFiles(
  sourceDir: string,
  relativePaths: readonly string[],
  sourceKind: string,
): Promise<void> {
  const expected = [...new Set(relativePaths)].sort();
  const present = await Promise.all(
    expected.map(async (relativePath) => ({
      relativePath,
      present: await isRegularFile(join(sourceDir, relativePath)),
    })),
  );
  const missing = present
    .filter(({ present: exists }) => !exists)
    .map(({ relativePath }) => relativePath);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${sourceKind} source files (${String(missing.length)}): ${missing.join(", ")}`,
    );
  }
}
