import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0,
  FoundryUniversalIntakeFileSchema,
  FoundryUniversalIntakeReceiptSchema,
  classifyUniversalIntakeProbe,
  inspectUniversalIntake,
  inspectUniversalIntakeWithSourceFacts,
} from "../intake-receipt.js";

const cleanup: string[] = [];
const FIXED_MTIME = new Date("2026-07-13T09:08:07.000Z");

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-intake-"));
  cleanup.push(root);
  await mkdir(join(root, "sparse", "0"), { recursive: true });
  const fixtures = new Map<string, Uint8Array | string>([
    ["capture.e57", Buffer.from("ASTM-E57\0capture", "ascii")],
    ["copy-one.spz", Buffer.from("duplicate-content", "ascii")],
    ["copy-two.spz", Buffer.from("duplicate-content", "ascii")],
    ["model.xbin", Buffer.from("XBAGproprietary", "ascii")],
    ["notes.weird", "opaque notes"],
    ["poses.csv", "timestamp,x,y,z\n0,0,0,0\n"],
    ["sparse/0/cameras.txt", "# Camera list\n1 PINHOLE 100 100 50 50 50 50\n"],
    [
      "splat.ply",
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float f_dc_0\nproperty float scale_0\nproperty float rot_0\nend_header\n",
    ],
    ["view.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
  ]);
  for (const [relativePath, contents] of fixtures) {
    const path = join(root, ...relativePath.split("/"));
    await writeFile(path, contents);
    await utimes(path, FIXED_MTIME, FIXED_MTIME);
  }
  return root;
}

describe("universal intake receipt", () => {
  it.each([
    ["capture.e57", "4153544d2d453537", "", "generic_e57"],
    ["cloud.las", "4c415346", "", "las_laz"],
    ["cloud.laz", "4c415346", "", "las_laz"],
    ["cloud.ply", "706c79", "ply\nformat binary_little_endian 1.0\nend_header\n", "ply_point_cloud"],
    ["scene.spz", "1f8b", "", "spz"],
    ["scene.sog", "504b0304", "", "sog"],
    ["scene.lcc", "", "", "lcc"],
    ["scene.lcc2", "", "", "lcc2"],
    ["capture.xbin", "58424147", "", "xgrids_xbin"],
    ["shell.obj", "", "", "obj"],
    ["shell.fbx", "", "", "fbx"],
    ["shell.glb", "676c5446", "", "glb_gltf"],
    ["shell.usdc", "", "", "openusd"],
    ["view.jpg", "ffd8", "", "generic_image"],
    ["walkthrough.mp4", "", "", "video"],
    ["sparse/0/images.txt", "", "# Image list", "colmap_sparse_model"],
    ["camera-calibration.yaml", "", "", "calibration_bundle"],
    ["poses.txt", "", "", "trajectory"],
    ["sensors.mcap", "", "", "sensor_log_mcap"],
  ] as const)("classifies %s for intake evidence", (relativePath, magicHex, header, expectedType) => {
    const detection = classifyUniversalIntakeProbe({
      relativePath,
      magicHex,
      boundedHeaderText: header,
    });

    expect(detection.candidates.some((candidate) => candidate.inputType === expectedType)).toBe(true);
  });

  it("keeps an unrecognized extension explicitly unknown", () => {
    expect(classifyUniversalIntakeProbe({
      relativePath: "capture.opaque",
      magicHex: "",
      boundedHeaderText: "",
    })).toMatchObject({ status: "unknown", candidates: [] });
  });

  it("stops Source Facts at the receipt boundary when the receipt contains XBIN", async () => {
    const root = await fixtureRoot();
    const result = await inspectUniversalIntakeWithSourceFacts(root);

    expect(result.sourceFacts).toMatchObject({
      state: "unavailable",
      assets: [],
      reason: { code: "XGRIDS_XBIN_UNSUPPORTED" },
      affectedSources: [{ path: "model.xbin", inputType: "xgrids_xbin" }],
    });
    expect(result.sourceFacts.receiptSha256).toBe(result.receipt.receiptSha256);
  });

  it("cancels before filesystem discovery when a local session stops", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(inspectUniversalIntake("missing-capture", { signal: controller.signal }))
      .rejects.toThrow("intake inspection was cancelled");
  });

  it("recursively inventories, classifies, quarantines, and groups exact duplicates deterministically", async () => {
    const root = await fixtureRoot();
    const sourceBefore = await readFile(join(root, "capture.e57"));

    const first = await inspectUniversalIntake(root);
    const second = await inspectUniversalIntake(root);

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe(FOUNDRY_UNIVERSAL_INTAKE_RECEIPT_V0);
    expect(first.policy).toEqual({
      sourceAccess: "read_only",
      networkAccess: "no_network_clients",
      cloudDispatch: "none",
      reconstruction: "none",
      manifestPromotion: "none",
      rightsStatus: "unreviewed",
      filesystemTrust: "local_or_removable_operator_controlled",
    });
    expect(first.files.map((file) => file.path)).toEqual([
      "capture.e57",
      "copy-one.spz",
      "copy-two.spz",
      "model.xbin",
      "notes.weird",
      "poses.csv",
      "sparse/0/cameras.txt",
      "splat.ply",
      "view.jpg",
    ]);
    expect(first.files.every((file) =>
      file.status === "quarantined" &&
      !file.manifestEligible &&
      file.quarantine.some((item) =>
        item.reason === "rights_unreviewed" && item.nextAction.startsWith("Have an authorized person")
      ) &&
      file.quarantine.some((item) =>
        item.reason === "provenance_unreviewed" && item.nextAction.includes("before admission")
      )
    )).toBe(true);
    expect(first.files.find((file) => file.path === "capture.e57")?.detection).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "generic_e57", confidence: "high" }],
    });
    expect(first.files.find((file) => file.path === "sparse/0/cameras.txt")?.detection).toMatchObject({
      status: "detected",
      candidates: [{ inputType: "colmap_sparse_model", confidence: "medium" }],
    });
    expect(first.files.find((file) => file.path === "model.xbin")?.quarantine)
      .toContainEqual(expect.objectContaining({
        reason: "opaque_or_proprietary_format",
        nextAction: expect.stringContaining("official export"),
      }));
    expect(first.files.find((file) => file.path === "notes.weird")?.quarantine)
      .toContainEqual(expect.objectContaining({
        reason: "format_unknown",
        nextAction: expect.stringContaining("identify the format"),
      }));
    expect(first.files.find((file) => file.path === "view.jpg")?.quarantine)
      .toContainEqual(expect.objectContaining({
        reason: "format_ambiguous",
        nextAction: expect.stringContaining("source context"),
      }));
    expect(first.duplicateGroups).toHaveLength(1);
    expect(first.duplicateGroups[0]?.paths).toEqual(["copy-one.spz", "copy-two.spz"]);
    expect(first.files.find((file) => file.path === "copy-one.spz")?.duplicate).toMatchObject({
      status: "exact_content_duplicate",
    });
    const duplicateReference = first.files.find((file) => file.path === "copy-one.spz")?.duplicate;
    expect(duplicateReference === undefined || "paths" in duplicateReference).toBe(false);
    expect(first.summary).toMatchObject({
      fileCount: 9,
      quarantinedCount: 9,
      duplicateGroupCount: 1,
      unknownFormatCount: 1,
    });
    expect(first.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(FoundryUniversalIntakeReceiptSchema.safeParse({
      ...first,
      summary: { ...first.summary, fileCount: first.summary.fileCount - 1 },
    }).success).toBe(false);
    const firstFile = first.files[0];
    const rightsAction = firstFile?.quarantine.find((item) => item.reason === "rights_unreviewed");
    expect(firstFile).toBeDefined();
    expect(rightsAction).toBeDefined();
    expect(FoundryUniversalIntakeFileSchema.safeParse({
      ...firstFile,
      quarantine: [rightsAction, rightsAction],
    }).success).toBe(false);
    expect("assets" in first).toBe(false);
    expect(await readFile(join(root, "capture.e57"))).toEqual(sourceBefore);
  });

  it("accepts one dropped file without copying or rewriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-single-intake-"));
    cleanup.push(root);
    const source = join(root, "room.glb");
    await writeFile(source, Buffer.from("glTF\u0002\u0000\u0000\u0000", "binary"));
    await utimes(source, FIXED_MTIME, FIXED_MTIME);

    const receipt = await inspectUniversalIntake(source);

    expect(receipt.source.kind).toBe("file");
    expect(receipt.files).toHaveLength(1);
    expect(receipt.files[0]).toMatchObject({
      path: "room.glb",
      modifiedAt: FIXED_MTIME.toISOString(),
      manifestEligible: false,
    });
  });

  it("bounds decoded header text independently from the retained byte head", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-large-header-"));
    cleanup.push(root);
    const source = join(root, "large.ply");
    const header = "ply\nformat ascii 1.0\nend_header\n";
    await writeFile(source, `${header}${"a".repeat(70_000)}`);
    await utimes(source, FIXED_MTIME, FIXED_MTIME);

    const receipt = await inspectUniversalIntake(source);

    expect(receipt.files).toHaveLength(1);
    expect(receipt.files[0]?.inspection.headerBytesRead).toBe(64 * 1_024);
    expect(receipt.files[0]?.detection.candidates[0]?.inputType).toBe("ply_point_cloud");
  });

  it("sorts the complete recursive path set instead of leaking depth-first traversal order", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-intake-global-sort-"));
    cleanup.push(root);
    await mkdir(join(root, "a"));
    await writeFile(join(root, "a", "z.e57"), "ASTM-E57 nested");
    await writeFile(join(root, "a.txt"), "root file");

    const receipt = await inspectUniversalIntake(root);

    expect(receipt.files.map((file) => file.path)).toEqual(["a.txt", "a/z.e57"]);
  });

  it("never follows a symbolic-link source entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "foundry-intake-link-"));
    cleanup.push(root);
    const outside = await mkdtemp(join(tmpdir(), "foundry-intake-outside-"));
    cleanup.push(outside);
    await writeFile(join(outside, "secret.e57"), "ASTM-E57");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

    await expect(inspectUniversalIntake(root)).rejects.toThrow("Symbolic links are not inspected");
  });

  it.runIf(process.platform === "win32")("rejects UNC and Windows device paths before filesystem access", async () => {
    await expect(inspectUniversalIntake("\\\\server\\share\\capture.e57"))
      .rejects.toThrow("UNC and device paths are not accepted");
    await expect(inspectUniversalIntake("\\\\.\\NUL"))
      .rejects.toThrow("UNC and device paths are not accepted");
  });
});
