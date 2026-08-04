import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "../build-manifest.js";
import {
  expectedContentPaths,
  verifyBundleContent,
  withVerifiedContentHashes,
} from "../bundle-integrity.js";

function manifest() {
  return buildManifest(
    { "0": { rotation: [1, 0, 0, 0], translation: [0, 0, 1.5] } },
    {
      venueSlug: "trades-hall",
      name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm",
      imagery: "equirect",
      generatedAt: "2026-07-10T00:00:00.000Z",
    },
  );
}

async function writeDeclaredFiles(outDir: string): Promise<void> {
  for (const path of expectedContentPaths(manifest())) {
    await mkdir(dirname(join(outDir, path)), { recursive: true });
    await writeFile(join(outDir, path), `content:${path}`);
  }
}

describe("bundle integrity", () => {
  it("accepts exactly the files and SHA-256 digests declared by the manifest", async () => {
    const out = await mkdtemp(join(tmpdir(), "forge-integrity-"));
    await writeDeclaredFiles(out);

    const finalized = await withVerifiedContentHashes(out, manifest());
    expect(Object.keys(finalized.contentHashes ?? {}).sort()).toEqual(
      expectedContentPaths(finalized),
    );
    await expect(verifyBundleContent(out, finalized)).resolves.toBeUndefined();
  });

  it("rejects missing, unexpected, and post-hash modified files", async () => {
    const out = await mkdtemp(join(tmpdir(), "forge-integrity-"));
    await writeDeclaredFiles(out);
    const finalized = await withVerifiedContentHashes(out, manifest());
    const [firstPath] = expectedContentPaths(finalized);
    if (firstPath === undefined) throw new Error("fixture must declare content");

    await writeFile(join(out, firstPath), "modified");
    await expect(verifyBundleContent(out, finalized)).rejects.toThrow("SHA-256 mismatch");

    await writeFile(join(out, firstPath), `content:${firstPath}`);
    await mkdir(join(out, "nested"), { recursive: true });
    await writeFile(join(out, "nested", "manifest.json"), "not exempt from hashing");
    await expect(withVerifiedContentHashes(out, manifest())).rejects.toThrow(
      "unexpected: nested/manifest.json",
    );

    await rm(join(out, "nested"), { recursive: true });
    await rm(join(out, firstPath));
    await expect(withVerifiedContentHashes(out, manifest())).rejects.toThrow(
      `missing: ${firstPath}`,
    );
  });
});
