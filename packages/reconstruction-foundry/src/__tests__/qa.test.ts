import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertTwinGraphIntegrity, inspectTwinBundle } from "../qa.js";
import { twinFixture, vp8xWebp } from "./fixture.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Twin release machine QA", () => {
  it("verifies a complete bundle without mutating it", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    const manifestBefore = await readFile(join(fixture.root, "manifest.json"));
    const result = await inspectTwinBundle(fixture.root);
    expect(result.checks).toHaveLength(7);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
    expect(result.webpFilesChecked).toBe(6);
    expect(result.inventory.files).toHaveLength(8);
    expect(await readFile(join(fixture.root, "manifest.json"))).toEqual(manifestBefore);
  });

  it("rejects a one-byte content mutation", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    const path = join(fixture.root, "tiles", "scan_000", "equirect_512.webp");
    const bytes = await readFile(path);
    bytes[29] = bytes[29]! ^ 1;
    await writeFile(path, bytes);
    await expect(inspectTwinBundle(fixture.root)).rejects.toThrow("SHA-256 mismatch");
  });

  it("rejects undeclared files", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    await writeFile(join(fixture.root, "unexpected.webp"), await vp8xWebp(512, 256));
    await expect(inspectTwinBundle(fixture.root)).rejects.toThrow("unexpected.webp");
  });

  it("rejects non-canonical manifest extensions instead of silently stripping them", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    const manifestPath = join(fixture.root, "manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    raw.unreviewedFlag = true;
    await writeFile(manifestPath, `${JSON.stringify(raw)}\n`);
    await expect(inspectTwinBundle(fixture.root)).rejects.toThrow("unknown fields");
  });

  it("rejects dimension drift even when a manifest hash is updated", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    const relativePath = "tiles/scan_000/equirect_512.webp";
    const imagePath = join(fixture.root, ...relativePath.split("/"));
    const wrong = await vp8xWebp(1024, 512);
    await writeFile(imagePath, wrong);
    const manifestPath = join(fixture.root, "manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    const { createHash } = await import("node:crypto");
    raw.contentHashes[relativePath] = createHash("sha256").update(wrong).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(raw)}\n`);
    await expect(inspectTwinBundle(fixture.root)).rejects.toThrow("expected 512×256");
  });

  it("accepts only the producer's nearest-millimetre edge rounding envelope", async () => {
    const fixture = await twinFixture();
    cleanup.push(fixture.root);
    const withinRounding = structuredClone(fixture.manifest);
    withinRounding.edges[0]!.distanceM = 1.0005;
    expect(() => { assertTwinGraphIntegrity(withinRounding); }).not.toThrow();
    const outsideRounding = structuredClone(fixture.manifest);
    outsideRounding.edges[0]!.distanceM = 1.00051;
    expect(() => { assertTwinGraphIntegrity(outsideRounding); }).toThrow("distance is inconsistent");
  });
});
