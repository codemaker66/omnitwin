import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCapture } from "../inventory.js";
import { stageCapture } from "../stage.js";
import { e57Fixture } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function roots(): Promise<{ source: string; staging: string }> {
  const parent = await mkdtemp(join(tmpdir(), "capture-stage-"));
  cleanup.push(parent);
  const source = join(parent, "source");
  const staging = join(parent, "staging");
  await mkdir(source);
  await writeFile(join(source, "cloud_0.e57"), e57Fixture());
  return { source, staging };
}

describe("stageCapture", () => {
  it("copies through a verified partial and is idempotent", async () => {
    const { source, staging } = await roots();
    const first = await stageCapture(source, staging);
    expect(first).toMatchObject({ copied: 1, resumed: 0, skipped: 0 });
    expect(await readFile(join(staging, "source", "e57", "cloud_0.e57"))).toEqual(e57Fixture());
    const inspection = JSON.parse(
      await readFile(join(staging, "capture-intake-inspection.json"), "utf8"),
    ) as { planSha256?: unknown };
    expect(inspection.planSha256).toBe(first.manifest.planSha256);
    const second = await stageCapture(source, staging);
    expect(second).toMatchObject({ copied: 0, resumed: 0, skipped: 1 });
  });

  it("promotes a complete matching partial on resume", async () => {
    const { source, staging } = await roots();
    const inspection = await inspectCapture(source);
    const entry = inspection.copyPlan[0]!;
    const target = join(staging, ...entry.targetRelativePath.split("/"));
    const partial = `${target}.partial-${entry.sha256.slice(0, 16)}`;
    await mkdir(dirname(partial), { recursive: true });
    await copyFile(join(source, "cloud_0.e57"), partial);
    const result = await stageCapture(source, staging);
    expect(result).toMatchObject({ copied: 0, resumed: 1, skipped: 0 });
  });

  it("preserves and rejects a conflicting final target", async () => {
    const { source, staging } = await roots();
    const target = join(staging, "source", "e57", "cloud_0.e57");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "not the source");
    await expect(stageCapture(source, staging)).rejects.toThrow("conflicts with copy plan");
    expect(await readFile(target, "utf8")).toBe("not the source");
  });

  it("rejects staging nested inside the source before writing", async () => {
    const { source } = await roots();
    await expect(stageCapture(source, join(source, "staging"))).rejects.toThrow(
      "must not be inside capture source",
    );
  });
});
