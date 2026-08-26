import { createHash } from "node:crypto";
import {
  cpSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildT554BoundaryReviewPack,
  canonicalizeT554PoseDocument,
  GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN,
  GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA,
  verifyPersistedT554BoundaryReviewPack,
  verifyT554SvgSafety,
  writeT554BoundaryReviewPack,
  type T554BoundaryReviewBuildInputs,
} from "../grand-hall-t554-boundary-review.js";
import { parseGrandHallT554BoundaryReviewArguments } from "../grand-hall-t554-boundary-review-cli.js";
import { stableCanonicalJson, type JsonValue } from "../grand-hall-room9-boundary.js";

const SYNTHETIC_OBJ = `
v 0 0 0
v 3 0 0
v 0 2 0
v 3 2 0
v 0 2 2
v 1 2 2
v 1 2 0
v 1.25 2 0
v 2.25 2 0
v 1.25 2 2
v 2.25 2 2
v 0.5 3 0
v 1.75 3 0
g chunk000_group001_sub009
usemtl texture_000.jpg
f 1 2 3
f 2 4 3
f 3 7 5
f 7 6 5
f 8 9 10
f 9 11 10
g chunk001_group001_sub013
usemtl texture_001.jpg
f 3 7 12
f 7 6 12
f 6 5 12
f 5 3 12
g chunk002_group001_sub014
usemtl texture_002.jpg
f 8 9 13
f 9 11 13
f 11 10 13
f 10 8 13
`;

function syntheticMtl(): string {
  return Array.from({ length: 144 }, (_, index) => {
    const name = `texture_${String(index).padStart(3, "0")}.jpg`;
    return `newmtl ${name}\nmap_Ka ${name}\nmap_Kd ${name}\n`;
  }).join("\n");
}

function syntheticPoses(): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Array.from({ length: 149 }, (_, index) => [
      String(index),
      { rotation: [1, 0, 0, 0], translation: [0.25, 0.25, 1.5] },
    ]),
  );
}

function sourceIdentity(character: string, locator: string): {
  readonly sourceLocator: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
} {
  return {
    sourceLocator: locator,
    byteLength: 1,
    sha256: `sha256:${character.repeat(64)}`,
  };
}

function inputs(): T554BoundaryReviewBuildInputs {
  const posesJson = syntheticPoses();
  const canonicalPoses = canonicalizeT554PoseDocument(
    new TextEncoder().encode(JSON.stringify(posesJson)),
  );
  return {
    sources: {
      obj: sourceIdentity("1", "MATTERPAK_SOURCE_ROOT/model.obj"),
      mtl: sourceIdentity("2", "MATTERPAK_SOURCE_ROOT/model.mtl"),
      colorPlan: sourceIdentity("3", "MATTERPAK_SOURCE_ROOT/colorplan_001.jpg"),
      ceilingColorPlan: sourceIdentity("4", "MATTERPAK_SOURCE_ROOT/ceilingcolorplan_001.jpg"),
      poses: sourceIdentity("5", "E57_SOURCE_ROOT/poses.json"),
    },
    objText: SYNTHETIC_OBJ,
    mtlText: syntheticMtl(),
    posesJson,
    poseCanonicalSha256: canonicalPoses.canonicalSha256,
  };
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function mutableRecord(value: unknown, label: string): Record<string, unknown> {
  return record(value, label) as Record<string, unknown>;
}

function resealBoundaryManifest(
  directory: string,
  mutate: (manifest: Record<string, unknown>) => void,
): void {
  const path = join(directory, "manifest.json");
  const manifest = mutableRecord(JSON.parse(readFileSync(path, "utf8")), "boundary manifest");
  mutate(manifest);
  delete manifest.manifestSha256;
  manifest.manifestSha256 = `sha256:${createHash("sha256")
    .update(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}\n${stableCanonicalJson(manifest as JsonValue)}`,
      "utf8",
    )
    .digest("hex")}`;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function materialNamesForRoom(value: unknown, groupIndex: number, subIndex: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("material references must be an array");
  for (const [index, entry] of value.entries()) {
    const reference = record(entry, `material reference ${String(index)}`);
    const room = record(reference.room, `material reference ${String(index)} room`);
    if (room.groupIndex !== groupIndex || room.subIndex !== subIndex) continue;
    if (!Array.isArray(reference.materialNames)) throw new Error("material names must be an array");
    return reference.materialNames;
  }
  throw new Error(`material reference ${String(groupIndex)}:${String(subIndex)} is absent`);
}

describe("T-554 authority-none boundary review pack", () => {
  it("canonicalizes equivalent retained pose serializations to one value digest", () => {
    const poses = syntheticPoses();
    const compactBytes = new TextEncoder().encode(JSON.stringify(poses));
    const reordered = Object.fromEntries(Object.entries(poses).reverse().map(([key, value]) => {
      const pose = record(value, `reordered pose ${key}`);
      return [key, { translation: pose.translation, rotation: pose.rotation }];
    }));
    const prettyBytes = new TextEncoder().encode(JSON.stringify(reordered, null, 2));
    expect(prettyBytes).not.toEqual(compactBytes);
    const compact = canonicalizeT554PoseDocument(compactBytes);
    const pretty = canonicalizeT554PoseDocument(prettyBytes);
    expect(pretty.canonicalSha256).toBe(compact.canonicalSha256);
    expect(pretty.posesJson).toEqual(compact.posesJson);
  });

  it("builds deterministic source-only visuals with unresolved interface diagnostics", () => {
    const first = buildT554BoundaryReviewPack(inputs());
    const second = buildT554BoundaryReviewPack(inputs());
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect([...second.files]).toEqual([...first.files]);
    expect(first.files.size).toBe(7);
    for (const svg of first.files.values()) {
      expect(() => {
        verifyT554SvgSafety(svg);
      }).not.toThrow();
      expect(svg).toContain("REVIEW");
      expect(svg).not.toContain("<script");
    }

    const manifest = record(first.manifest, "manifest");
    expect(manifest.schemaVersion).toBe(GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA);
    expect(manifest.authority).toMatchObject({
      state: "none",
      reviewState: "human_pending",
      portalClosureAuthored: false,
      closedVolumeAuthored: false,
      runtimeAuthority: false,
      trainingAuthority: false,
    });
    expect(manifest.sourceTexturePolicy).toMatchObject({
      mode: "flat_geometry_only",
      sourceTextureBytesRead: false,
      sourceTextureBytesDecoded: false,
    });
    expect(manifest.poseRawToCanonicalLineage).toMatchObject({
      rawSourceBinding: "sourceBindings.posesRaw",
      rawByteIdentityRequiredForRegeneration: true,
      canonicalSha256: inputs().poseCanonicalSha256,
      stagedPoseFileDependency: false,
    });
    const exhaustive = record(manifest.exhaustiveSharedInterfaces, "interfaces");
    expect(exhaustive.interfaceCount).toBe(2);
    expect(exhaustive.allInterfacesResolved).toBe(false);
    expect(exhaustive.interfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomB: { groupIndex: 1, subIndex: 13 }, reviewState: "pending" }),
        expect.objectContaining({ roomB: { groupIndex: 1, subIndex: 14 }, reviewState: "pending" }),
      ]),
    );
    expect(exhaustive.interfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ candidateRole: "shared_topology_unresolved" }),
      ]),
    );
    expect(manifest.sharedInterfacePlaneFitDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "review_only_shared_interface_plane_fit",
          architecturalInference: "none",
          portalOrDoorwayInferred: false,
          closureAuthored: false,
        }),
      ]),
    );
  });

  it("rejects active, linked, external, and path-bearing SVG content", () => {
    const safe = '<svg xmlns="http://www.w3.org/2000/svg" role="img"><title>safe</title></svg>\n';
    expect(() => {
      verifyT554SvgSafety(safe);
    }).not.toThrow();
    for (const unsafe of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="outside.png"/></svg>\n',
      '<svg xmlns="http://www.w3.org/2000/svg"><path onload="x()"/></svg>\n',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>C:\\capture\\room.obj</text></svg>\n',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>https://example.com</text></svg>\n',
    ]) {
      expect(() => {
        verifyT554SvgSafety(unsafe);
      }).toThrow(/forbidden|external/u);
    }
  });

  it("parses exact CLI boundaries and rejects missing or duplicate options", () => {
    expect(
      parseGrandHallT554BoundaryReviewArguments([
        "--check",
        "--source-root",
        "Q:\\matterpak",
        "--poses",
        "Q:\\poses.json",
        "--out",
        "Q:\\review",
      ]),
    ).toEqual({
      check: true,
      matterpakSourceRoot: "Q:\\matterpak",
      posesJsonPath: "Q:\\poses.json",
      outputDirectory: "Q:\\review",
    });
    expect(() => parseGrandHallT554BoundaryReviewArguments(["--check"])).toThrow(/required/u);
    expect(() =>
      parseGrandHallT554BoundaryReviewArguments([
        "--source-root", "Q:\\a", "--source-root", "Q:\\b", "--poses", "Q:\\p", "--out", "Q:\\o",
      ]),
    ).toThrow(/repeated/u);
    expect(() => parseGrandHallT554BoundaryReviewArguments(["--unknown"])).toThrow(/unknown/u);
  });
});

describe("checked-in T-554 boundary review artifact", () => {
  it("is self-contained, hash-bound, exhaustive, and authority-none", () => {
    const artifactUrl = new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/",
      import.meta.url,
    );
    const directory = artifactUrl.pathname.startsWith("/") && /^[A-Za-z]:/u.test(artifactUrl.pathname.slice(1))
      ? artifactUrl.pathname.slice(1)
      : artifactUrl.pathname;
    const digest = verifyPersistedT554BoundaryReviewPack(directory);
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const manifest: unknown = JSON.parse(readFileSync(new URL("manifest.json", artifactUrl), "utf8"));
    const root = record(manifest, "manifest");
    expect(root.room9Topology).toMatchObject({
      faceCount: 119_564,
      uniqueUndirectedEdgeCount: 180_197,
      boundaryEdgeCount: 1_702,
      boundaryVertexCount: 1_675,
      boundaryComponentCount: 301,
      boundaryComponentKinds: { loop: 280, open: 0, branched: 21 },
      watertight: false,
      closedVolumeClaim: false,
    });
    expect(root.sourceBindings).toMatchObject({
      obj: {
        byteLength: 38_381_816,
        sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
      },
      mtl: {
        byteLength: 20_879,
        sha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
      },
      colorPlan: {
        byteLength: 2_125_761,
        sha256: "sha256:95ea727b1c6426158f954a9f6f6c00fb60e838203f83a39b901ddb25f9417212",
      },
      ceilingColorPlan: {
        byteLength: 1_982_157,
        sha256: "sha256:e94e9d6389000ea18d64aa875e2af75ee88ad31d4df970d449b99a2591f6064a",
      },
      posesRaw: {
        sourceLocator: "E57_SOURCE_ROOT/poses.json",
        byteLength: 39_717,
        sha256: "sha256:b181eee225ad5019caec82c207d6e996be0cddf8852048b50f430f77707dc364",
      },
    });
    expect(root.poseRawToCanonicalLineage).toMatchObject({
      rawSourceBinding: "sourceBindings.posesRaw",
      rawByteIdentityRequiredForRegeneration: true,
      canonicalSha256: "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3",
      expectedCanonicalSha256: "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3",
      stagedPoseFileDependency: false,
    });
    const texturePolicy = record(root.sourceTexturePolicy, "texture policy");
    expect(texturePolicy).toMatchObject({
      mode: "flat_geometry_only",
      sourceTextureBytesRead: false,
      sourceTextureBytesHashed: false,
      sourceTextureBytesDecoded: false,
    });
    expect(materialNamesForRoom(texturePolicy.referencedMaterialNamesByRoom, 1, 9)).toHaveLength(42);
    expect(materialNamesForRoom(texturePolicy.referencedMaterialNamesByRoom, 1, 13)).toEqual([
      "424ff41f6e5d41969c635fcd61be9b3f_137.jpg",
    ]);
    expect(materialNamesForRoom(texturePolicy.referencedMaterialNamesByRoom, 1, 14)).toEqual([
      "424ff41f6e5d41969c635fcd61be9b3f_143.jpg",
    ]);
    const exhaustive = record(root.exhaustiveSharedInterfaces, "interfaces");
    expect(exhaustive.interfaceCount).toBe(8);
    expect(exhaustive.interfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomB: { groupIndex: 1, subIndex: 13 }, sharedVertexCount: 72 }),
        expect.objectContaining({ roomB: { groupIndex: 1, subIndex: 14 }, sharedVertexCount: 62 }),
        expect.objectContaining({ roomB: { groupIndex: 0, subIndex: 4 }, sharedVertexCount: 15 }),
        expect.objectContaining({ roomB: { groupIndex: 0, subIndex: 2 }, sharedVertexCount: 10 }),
      ]),
    );
    const roomScalePlan = readFileSync(new URL("plan-xy.svg", artifactUrl), "utf8");
    expect(roomScalePlan).toContain("All 8 shared-index interfaces");
    expect(roomScalePlan).toContain("candidate centres rendered here: 48");
    for (const interfaceId of [
      "matterpak-1-9-0-2",
      "matterpak-1-9-0-3",
      "matterpak-1-9-0-4",
      "matterpak-1-9-1-10",
      "matterpak-1-9-1-11",
      "matterpak-1-9-1-12",
      "matterpak-1-9-1-13",
      "matterpak-1-9-1-14",
    ]) {
      expect(roomScalePlan).toContain(`${interfaceId} · adjacent`);
    }
    const cameraOverview = readFileSync(new URL("camera-overview-diagnostic.svg", artifactUrl), "utf8");
    expect(cameraOverview).toContain("E57 camera-centre diagnostic overview");
    expect(cameraOverview).toContain("DIAGNOSTIC IDENTITY ONLY — ALL 149 CENTRES");
    expect(JSON.stringify(root)).not.toMatch(/[A-Za-z]:[\\/]/u);
  });

  it("rejects an existing output, inventory drift, byte drift, and linked output root", () => {
    const artifactUrl = new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/",
      import.meta.url,
    );
    const artifactDirectory = fileURLToPath(artifactUrl);
    const temporaryPrefix = join(tmpdir(), "omnitwin-t554-boundary-");
    const temporaryRoot = mkdtempSync(temporaryPrefix);
    if (!temporaryRoot.startsWith(temporaryPrefix)) {
      throw new Error("test runner returned an unexpected temporary directory");
    }
    try {
      expect(() => {
        writeT554BoundaryReviewPack({
          matterpakSourceRoot: temporaryRoot,
          posesJsonPath: join(temporaryRoot, "poses.json"),
          outputDirectory: temporaryRoot,
        });
      }).toThrow(/already exists/u);

      const copyDirectory = join(temporaryRoot, "copy");
      cpSync(artifactDirectory, copyDirectory, { recursive: true });
      const unexpectedPath = join(copyDirectory, "unexpected.txt");
      writeFileSync(unexpectedPath, "inventory drift\n", "utf8");
      expect(() => verifyPersistedT554BoundaryReviewPack(copyDirectory)).toThrow(/inventory drifted/u);
      unlinkSync(unexpectedPath);

      writeFileSync(join(copyDirectory, "plan-xy.svg"), "<svg></svg>\n", "utf8");
      expect(() => verifyPersistedT554BoundaryReviewPack(copyDirectory)).toThrow(/bytes drifted/u);

      const linkedDirectory = join(temporaryRoot, "linked");
      symlinkSync(artifactDirectory, linkedDirectory, "junction");
      expect(() => verifyPersistedT554BoundaryReviewPack(linkedDirectory)).toThrow(/cannot be a link/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects canonically resealed source, interface, output, and architectural claim attacks", () => {
    const artifactDirectory = fileURLToPath(new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/",
      import.meta.url,
    ));
    const temporaryRoot = mkdtempSync(join(tmpdir(), "omnitwin-t554-boundary-adversarial-"));
    const cases: readonly {
      readonly name: string;
      readonly mutate: (manifest: Record<string, unknown>) => void;
    }[] = [
      {
        name: "invented portal role",
        mutate: (manifest) => {
          const exhaustive = mutableRecord(manifest.exhaustiveSharedInterfaces, "interfaces");
          const interfaces = exhaustive.interfaces;
          if (!Array.isArray(interfaces)) throw new Error("interface inventory is absent");
          mutableRecord(interfaces[0], "first interface").candidateRole = "portal_plane_candidate";
        },
      },
      {
        name: "rewritten OBJ receipt",
        mutate: (manifest) => {
          const bindings = mutableRecord(manifest.sourceBindings, "source bindings");
          mutableRecord(bindings.obj, "OBJ binding").sha256 = `sha256:${"0".repeat(64)}`;
        },
      },
      {
        name: "rewritten shared positions",
        mutate: (manifest) => {
          const exhaustive = mutableRecord(manifest.exhaustiveSharedInterfaces, "interfaces");
          const interfaces = exhaustive.interfaces;
          if (!Array.isArray(interfaces)) throw new Error("interface inventory is absent");
          mutableRecord(interfaces[0], "first interface").sharedPositionsSha256 = `sha256:${"f".repeat(64)}`;
        },
      },
      {
        name: "rewritten interface bounds",
        mutate: (manifest) => {
          const exhaustive = mutableRecord(manifest.exhaustiveSharedInterfaces, "interfaces");
          const interfaces = exhaustive.interfaces;
          if (!Array.isArray(interfaces)) throw new Error("interface inventory is absent");
          mutableRecord(interfaces[0], "first interface").boundsMeters = {
            min: [0, 0, 0],
            max: [999, 999, 999],
          };
        },
      },
      {
        name: "rewritten plane-fit selection and metric",
        mutate: (manifest) => {
          const fits = manifest.sharedInterfacePlaneFitDiagnostics;
          if (!Array.isArray(fits)) throw new Error("plane-fit inventory is absent");
          const fit = mutableRecord(fits[0], "first plane fit");
          fit.selectionBasis = "doorway_selected_by_operator";
          fit.centroidMeters = [999, 999, 999];
        },
      },
      {
        name: "duplicate output path",
        mutate: (manifest) => {
          const outputs = manifest.outputs;
          if (!Array.isArray(outputs)) throw new Error("output inventory is absent");
          const first = mutableRecord(outputs[0], "first output");
          mutableRecord(outputs[1], "second output").relativePath = first.relativePath;
        },
      },
      {
        name: "invented closed geometry method",
        mutate: (manifest) => {
          manifest.geometryMethod = { closedBoundaryEstablished: true, inferredDoorways: true };
        },
      },
      {
        name: "invented generated texture policy",
        mutate: (manifest) => {
          manifest.sourceTexturePolicy = { generatedFillPermitted: true };
        },
      },
    ];
    try {
      cases.forEach(({ name, mutate }, index) => {
        const directory = join(temporaryRoot, `case-${String(index)}`);
        cpSync(artifactDirectory, directory, { recursive: true });
        resealBoundaryManifest(directory, mutate);
        expect(
          () => verifyPersistedT554BoundaryReviewPack(directory),
          name,
        ).toThrow();
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects an externally hard-linked persisted boundary manifest", () => {
    const artifactDirectory = fileURLToPath(new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/",
      import.meta.url,
    ));
    const temporaryRoot = mkdtempSync(join(tmpdir(), "omnitwin-t554-boundary-hardlink-"));
    const directory = join(temporaryRoot, "copy");
    const alias = join(temporaryRoot, "manifest-alias.json");
    try {
      cpSync(artifactDirectory, directory, { recursive: true });
      linkSync(join(directory, "manifest.json"), alias);
      expect(() => verifyPersistedT554BoundaryReviewPack(directory)).toThrow(/hard link/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
