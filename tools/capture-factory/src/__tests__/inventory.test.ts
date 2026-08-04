import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCapture } from "../inventory.js";
import { writeMinimalCapture } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "capture-inventory-"));
  cleanup.push(parent);
  const root = join(parent, "source");
  await writeMinimalCapture(root);
  return root;
}

describe("inspectCapture", () => {
  it("builds a stable minimal source plan and excludes experiments", async () => {
    const root = await fixtureRoot();
    const first = await inspectCapture(root);
    const second = await inspectCapture(root);
    expect(second).toEqual(first);
    expect(first.fileCount).toBe(7);
    expect(first.copyPlan.map((entry) => entry.targetRelativePath)).toEqual([
      "source/e57/cloud_0.e57",
      "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.mtl",
      "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.obj",
      "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f_000.jpg",
    ]);
    expect(first.files.find((file) => file.relativePath.endsWith("RC_ALIGNED.obj"))).toMatchObject({
      sha256: null,
      classification: { disposition: "exclude" },
    });
    expect(first.files.find((file) => file.relativePath === "poses.json")).toMatchObject({
      sha256: null,
      classification: { disposition: "reference_only" },
    });
  });

  it("hashes every file only when hashAll is explicit", async () => {
    const root = await fixtureRoot();
    const inspection = await inspectCapture(root, { hashAll: true });
    expect(inspection.hashedFileCount).toBe(inspection.fileCount);
  });
});
