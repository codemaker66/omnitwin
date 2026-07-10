import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

const READ_BUFFER_BYTES = 8 * 1024 * 1024;

export interface FileDigest {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
}

function sameFileState(
  before: { readonly size: number; readonly mtimeMs: number },
  after: { readonly size: number; readonly mtimeMs: number },
): boolean {
  return before.size === after.size && before.mtimeMs === after.mtimeMs;
}

export async function sha256File(path: string): Promise<FileDigest> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error(`Cannot hash a non-regular file: ${path}`);
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let position = 0;
    let bytesRead: number;
    do {
      ({ bytesRead } = await handle.read(buffer, 0, buffer.length, position));
      if (bytesRead > 0) {
        digest.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
    } while (bytesRead > 0);
    const after = await handle.stat();
    if (!sameFileState(before, after) || position !== after.size) {
      throw new Error(`Capture source changed while hashing: ${path}`);
    }
    return {
      sha256: digest.digest("hex"),
      sizeBytes: after.size,
      modifiedAtMs: after.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
