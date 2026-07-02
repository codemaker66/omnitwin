import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** SHA-256 every file under outDir (D-014 bundle shape), keyed by posix relpath. */
export async function hashBundle(outDir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name !== "manifest.json") {
        const rel = relative(outDir, full).split("\\").join("/");
        hashes[rel] = createHash("sha256").update(await readFile(full)).digest("hex");
      }
    }
  }
  await walk(outDir);
  return hashes;
}
