import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_RELEASE_MANIFEST_NAME,
  loadPreparedReconstructionRelease,
  prepareReconstructionRelease,
} from "../preparation.js";
import { twinFixture } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("immutable Foundry preparation", () => {
  it("prepares deterministic digest-bound sidecars idempotently", async () => {
    const fixture = await twinFixture();
    const parent = await mkdtemp(join(tmpdir(), "foundry-prepared-"));
    cleanup.push(fixture.root, parent);
    const outDir = join(parent, "evidence");
    const first = await prepareReconstructionRelease({ bundleRoot: fixture.root, outDir });
    const second = await prepareReconstructionRelease({ bundleRoot: fixture.root, outDir });
    expect(second.preparation).toEqual(first.preparation);
    expect(second.manifest.releaseDigest).toBe(first.manifest.releaseDigest);
    await expect(loadPreparedReconstructionRelease(outDir)).resolves.toEqual(second);
  });

  it("refuses output inside the source tree", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    await expect(prepareReconstructionRelease({
      bundleRoot: fixture.root,
      outDir: join(fixture.root, "foundry-output"),
    })).rejects.toThrow("must not contain or sit inside");
  });

  it("refuses to replace a conflicting sidecar", async () => {
    const fixture = await twinFixture();
    const parent = await mkdtemp(join(tmpdir(), "foundry-conflict-"));
    cleanup.push(fixture.root, parent);
    const outDir = join(parent, "evidence");
    await prepareReconstructionRelease({ bundleRoot: fixture.root, outDir });
    const releasePath = join(outDir, FOUNDRY_RELEASE_MANIFEST_NAME);
    const original = await readFile(releasePath);
    await writeFile(releasePath, Buffer.concat([original, Buffer.from("tamper")]));
    await expect(prepareReconstructionRelease({ bundleRoot: fixture.root, outDir })).rejects.toThrow("Refusing to replace");
  });
});
