import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** List every regular bundle entry as a deterministic POSIX relative path. */
export async function listBundleFiles(outDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(relative(outDir, full).split("\\").join("/"));
      }
    }
  }
  await walk(outDir);
  return files;
}

/** SHA-256 every file under outDir (D-014 bundle shape), keyed by posix relpath. */
export async function hashBundle(outDir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relativePath of await listBundleFiles(outDir)) {
    // Only the root descriptor is self-referential. A nested file with this
    // basename is still content and must be hashed (then rejected as extra).
    if (relativePath === "manifest.json") continue;
    hashes[relativePath] = createHash("sha256")
      .update(await readFile(join(outDir, relativePath)))
      .digest("hex");
  }
  return hashes;
}
