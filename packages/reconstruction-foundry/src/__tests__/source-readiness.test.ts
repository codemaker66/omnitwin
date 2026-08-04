import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { inspectUniversalIntakeWithSourceFacts } from "../intake-receipt.js";
import {
  FOUNDRY_SOURCE_READINESS_LANE_IDS,
  FOUNDRY_SOURCE_READINESS_MAP_DIGEST_DOMAIN,
  FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS,
  FoundrySourceReadinessMapV1Schema,
  compileFoundrySourceReadinessMapV1,
  serializeFoundrySourceReadinessMapV1,
  type FoundrySourceReadinessMapV1,
} from "../source-readiness.js";
import {
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN,
  FoundryUniversalSourceFactsSchema,
  type FoundryUniversalSourceFacts,
} from "../source-facts.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function e57Fixture(size = 64): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write("ASTM-E57", 0, "ascii");
  bytes.writeUInt32LE(1, 8);
  bytes.writeUInt32LE(0, 12);
  bytes.writeBigUInt64LE(BigInt(size), 16);
  bytes.writeBigUInt64LE(48n, 24);
  bytes.writeBigUInt64LE(0n, 32);
  bytes.writeBigUInt64LE(1024n, 40);
  return bytes;
}

function glbFixture(jsonValue: unknown = {
  asset: { version: "2.0", generator: "readiness-test" },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
  accessors: [{ count: 3, componentType: 5126, type: "VEC3" }],
  buffers: [{ byteLength: 0 }],
}): Buffer {
  const json = Buffer.from(JSON.stringify(jsonValue), "utf8");
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(20 + paddedLength, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return bytes;
}

async function fixtureRoot(files: Readonly<Record<string, Uint8Array | string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-readiness-"));
  cleanup.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, ...relativePath.split("/"));
    const parent = path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
    if (parent !== root) await mkdir(parent, { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

async function inspect(files: Readonly<Record<string, Uint8Array | string>>) {
  const root = await fixtureRoot(files);
  return { root, ...(await inspectUniversalIntakeWithSourceFacts(root)) };
}

interface MutableSourceFactsDraft extends Record<string, unknown> {
  assets: Array<{
    inspection: { state: "established" | "facts_not_established" };
    source: { sha256: string };
  }>;
  factsSha256: string;
  summary: {
    assetCount: number;
    establishedCount: number;
    factsNotEstablishedCount: number;
    untargetedFileCount: number;
  };
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function reissueSourceFacts(
  value: Extract<FoundryUniversalSourceFacts, { readonly state: "available" }>,
  mutate: (draft: MutableSourceFactsDraft) => void,
): FoundryUniversalSourceFacts {
  const cloned = structuredClone(value);
  const draft: MutableSourceFactsDraft = {
    ...cloned,
    assets: cloned.assets.map((asset) => ({
      ...asset,
      inspection: { ...asset.inspection },
      source: { ...asset.source },
    })),
    summary: { ...cloned.summary },
  };
  mutate(draft);
  const { factsSha256: _factsSha256, ...payload } = draft;
  draft.factsSha256 = domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  return FoundryUniversalSourceFactsSchema.parse(draft);
}

function reissueReadiness(
  value: FoundrySourceReadinessMapV1,
  mutate: (draft: Mutable<FoundrySourceReadinessMapV1>) => void,
): unknown {
  const draft = structuredClone(value) as Mutable<FoundrySourceReadinessMapV1>;
  mutate(draft);
  const { readinessSha256: _readinessSha256, ...payload } = draft;
  draft.readinessSha256 = domainSeparatedSha256(
    FOUNDRY_SOURCE_READINESS_MAP_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  return draft;
}

function injectUnexpectedField(
  target: object,
  key: string,
  value: unknown,
): void {
  (target as Record<string, unknown>)[key] = value;
}

describe("Foundry Source Readiness Map V1", () => {
  it("builds a deterministic pre-admission map across every source family without route claims", async () => {
    const inspected = await inspect({
      "geometry/survey.e57": e57Fixture(),
      "geometry/shell.glb": glbFixture(),
      "geometry/shell.obj": "v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\n",
      "images/view.jpg": Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      "runtime/room.spz": Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
      "camera-calibration.yaml": "camera: pinhole\n",
      "notes.opaque": "unclassified notes\n",
    });
    const first = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    const second = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "omnitwin.foundry.source-readiness-map.v1",
      meaning: "pre_admission_source_candidate_map",
      basis: "exact_intake_receipt_and_universal_source_facts",
      receiptSha256: inspected.receipt.receiptSha256,
      sourceFactsSha256: inspected.sourceFacts.factsSha256,
      state: "available",
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        networkAccess: "none",
        admission: "not_evaluated",
        routeCompilation: "none",
        recipeCompilation: "none",
        workerSelection: "none",
        providerSelection: "none",
        execution: "not_authorized",
        authority: "none",
        rights: "not_evaluated",
        accuracy: "not_evaluated",
        registration: "not_evaluated",
      },
      summary: {
        receiptFileCount: 7,
        representedFileCount: 7,
        factsEstablishedCount: 3,
        outsideSourceFactsV1Count: 2,
        ambiguousFormatCount: 1,
        unclassifiedFormatCount: 1,
        affectedSourceCount: 0,
      },
    });
    expect(first.limitations).toEqual(FOUNDRY_SOURCE_READINESS_MAP_LIMITATIONS);
    expect(first.lanes.map((lane) => lane.id)).toEqual(FOUNDRY_SOURCE_READINESS_LANE_IDS);
    expect(first.files.map((file) => [file.path, file.status])).toEqual([
      ["camera-calibration.yaml", "outside_source_facts_v1"],
      ["geometry/shell.glb", "facts_established"],
      ["geometry/shell.obj", "facts_established"],
      ["geometry/survey.e57", "facts_established"],
      ["images/view.jpg", "ambiguous_format"],
      ["notes.opaque", "unclassified_format"],
      ["runtime/room.spz", "outside_source_facts_v1"],
    ]);
    if (first.state !== "available") throw new Error("expected an available readiness map");
    expect(first.lanes.find((lane) => lane.id === "point_geometry")).toMatchObject({
      status: "all_observed_facts_established",
      counts: { observedFileCount: 1, factsEstablishedCount: 1 },
    });
    expect(first.lanes.find((lane) => lane.id === "mesh_geometry")).toMatchObject({
      status: "all_observed_facts_established",
      counts: { observedFileCount: 2, factsEstablishedCount: 2 },
    });
    expect(first.lanes.find((lane) => lane.id === "image_video")).toMatchObject({
      status: "evidence_incomplete",
      counts: { observedFileCount: 1, ambiguousFormatCount: 1 },
    });
    expect(first.lanes.find((lane) => lane.id === "vendor_or_opaque_package")).toMatchObject({
      status: "no_source_observed",
      counts: { observedFileCount: 0 },
    });
    expect(first.files.find((file) => file.path === "geometry/survey.e57")?.unknowns.map((item) => item.code))
      .toEqual(expect.arrayContaining([
        "E57_POINT_COUNT_UNKNOWN",
        "E57_UNITS_UNKNOWN",
        "E57_CRS_UNKNOWN",
        "E57_BOUNDS_UNKNOWN",
        "E57_ACCURACY_UNKNOWN",
        "E57_REGISTRATION_UNKNOWN",
        "E57_RIGHTS_UNKNOWN",
      ]));
    expect(first.files.find((file) => file.path === "geometry/shell.glb")?.unknowns.map((item) => item.code))
      .toEqual(expect.arrayContaining(["GLB_DECODED_GEOMETRY_UNKNOWN", "GLB_REMAINING_CHUNKS_UNKNOWN"]));
    expect(first.files.find((file) => file.path === "geometry/shell.obj")?.unknowns.map((item) => item.code))
      .toEqual(expect.arrayContaining([
        "OBJ_UNITS_UNKNOWN",
        "OBJ_UP_AXIS_UNKNOWN",
        "OBJ_FRAME_UNKNOWN",
        "OBJ_TOPOLOGY_UNKNOWN",
        "OBJ_TRIANGULATION_UNKNOWN",
      ]));

    const serialized = serializeFoundrySourceReadinessMapV1(first);
    expect(serialized).toBe(serializeFoundrySourceReadinessMapV1(second));
    expect(serialized).not.toContain(inspected.root);
    expect(serialized).not.toContain("createdAt");
    expect(serialized).not.toMatch(/"(?:workerProfile|jobSpec|estimatedCost|winner|routeRoles)"/u);
    expect(serialized).not.toMatch(/\b(?:supported|processable)\b/iu);
  });

  it("keeps targeted parse failures and unsupported JSON glTF as candidates with incomplete evidence", async () => {
    const inspected = await inspect({
      "broken.e57": Buffer.from("ASTM-E57", "ascii"),
      "scene.gltf": "{}",
    });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");

    expect(map.files.map((file) => [file.path, file.status, file.inspection?.code])).toEqual([
      ["broken.e57", "facts_not_established", "E57_PHYSICAL_HEADER_TRUNCATED"],
      ["scene.gltf", "facts_not_established", "GLTF_JSON_VARIANT_UNSUPPORTED"],
    ]);
    expect(map.lanes.find((lane) => lane.id === "point_geometry")?.status).toBe("evidence_incomplete");
    expect(map.lanes.find((lane) => lane.id === "mesh_geometry")?.status).toBe("evidence_incomplete");
    expect(map.gaps.map((gap) => gap.code)).toContain("SOURCE_FACTS_NOT_ESTABLISHED");
  });

  it("represents an empty receipt as eight explicit no-source lanes", async () => {
    const inspected = await inspect({});
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");

    expect(map.files).toEqual([]);
    expect(map.lanes).toHaveLength(FOUNDRY_SOURCE_READINESS_LANE_IDS.length);
    expect(map.lanes.every((lane) =>
      lane.status === "no_source_observed" && lane.counts.observedFileCount === 0
    )).toBe(true);
    expect(map.gaps).toEqual([
      expect.objectContaining({
        code: "NO_SOURCE_OBSERVED",
        laneIds: FOUNDRY_SOURCE_READINESS_LANE_IDS,
        sourcePaths: [],
      }),
    ]);
    expect(map.summary).toMatchObject({
      receiptFileCount: 0,
      representedFileCount: 0,
      representedLaneCount: 0,
      gapCount: 1,
    });
  });

  it("keeps an established E57 and untargeted LAS together as incomplete point evidence", async () => {
    const inspected = await inspect({
      "survey.e57": e57Fixture(),
      "survey.las": Buffer.from("LASFsmall-fixture", "ascii"),
    });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");

    expect(map.lanes.find((lane) => lane.id === "point_geometry")).toMatchObject({
      status: "evidence_incomplete",
      counts: {
        observedFileCount: 2,
        factsEstablishedCount: 1,
        outsideSourceFactsV1Count: 1,
      },
    });
    expect(map.gaps.find((gap) => gap.code === "OUTSIDE_SOURCE_FACTS_V1")).toMatchObject({
      laneIds: ["point_geometry"],
      sourcePaths: ["survey.las"],
    });
    expect(map.files.find((file) => file.path === "survey.las")?.decisiveNextTests)
      .toContain("Add a bounded facts inspector for this exact format and rebuild Source Facts without selecting a processing route.");
  });

  it("preserves every candidate lane for an ambiguous multi-family source", async () => {
    const inspected = await inspect({ "calibration.ifc": "ISO-10303-21;\nEND-ISO-10303-21;\n" });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");

    expect(map.files[0]).toMatchObject({
      path: "calibration.ifc",
      status: "ambiguous_format",
      laneIds: ["mesh_geometry", "registration_and_control", "vendor_or_opaque_package"],
    });
    for (const laneId of [
      "mesh_geometry",
      "registration_and_control",
      "vendor_or_opaque_package",
    ] as const) {
      expect(map.lanes.find((lane) => lane.id === laneId)).toMatchObject({
        status: "evidence_incomplete",
        representedSources: [{ path: "calibration.ifc", status: "ambiguous_format" }],
      });
    }
    expect(map.gaps.find((gap) => gap.code === "AMBIGUOUS_FORMAT")).toMatchObject({
      laneIds: ["mesh_geometry", "registration_and_control", "vendor_or_opaque_package"],
      sourcePaths: ["calibration.ifc"],
    });
  });

  it("derives all five generic gaps with their exact paths and decisive tests", async () => {
    const inspected = await inspect({
      "broken.e57": Buffer.from("ASTM-E57", "ascii"),
      "image.jpg": Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      "notes.opaque": "unknown\n",
      "survey.las": Buffer.from("LASFsmall-fixture", "ascii"),
    });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");

    expect(map.gaps.map((gap) => gap.code)).toEqual([
      "AMBIGUOUS_FORMAT",
      "NO_SOURCE_OBSERVED",
      "OUTSIDE_SOURCE_FACTS_V1",
      "SOURCE_FACTS_NOT_ESTABLISHED",
      "UNCLASSIFIED_FORMAT",
    ]);
    expect(Object.fromEntries(map.gaps.map((gap) => [gap.code, gap.sourcePaths]))).toEqual({
      AMBIGUOUS_FORMAT: ["image.jpg"],
      NO_SOURCE_OBSERVED: [],
      OUTSIDE_SOURCE_FACTS_V1: ["survey.las"],
      SOURCE_FACTS_NOT_ESTABLISHED: ["broken.e57"],
      UNCLASSIFIED_FORMAT: ["notes.opaque"],
    });
    expect(map.gaps.every((gap) =>
      gap.reason.length > 0 && gap.decisiveNextTest.length > 0 && gap.laneIds.length > 0
    )).toBe(true);
  });

  it("uses byte magic ahead of a conflicting OBJ extension", async () => {
    const inspected = await inspect({ "conflict.obj": glbFixture() });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");
    expect(map.files[0]).toMatchObject({
      path: "conflict.obj",
      inputType: "glb_gltf",
      format: "glb",
      laneIds: ["mesh_geometry"],
      status: "facts_established",
    });
  });

  it("preserves duplicate paths but counts duplicate bytes once per lane", async () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    const inspected = await inspect({ "a.obj": obj, "nested/b.obj": obj });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });
    if (map.state !== "available") throw new Error("expected an available readiness map");
    const mesh = map.lanes.find((lane) => lane.id === "mesh_geometry");
    expect(mesh).toMatchObject({
      counts: { observedFileCount: 2, distinctContentCount: 1, factsEstablishedCount: 2 },
    });
    expect(mesh?.representedSources.map((source) => source.path)).toEqual(["a.obj", "nested/b.obj"]);
    expect(map.files.every((file) => file.duplicate.status === "exact_content_duplicate")).toBe(true);
  });

  it("withholds every file and lane reference when any XBIN candidate is present", async () => {
    const inspected = await inspect({
      "open.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
      "survey.e57": e57Fixture(),
      "vendor.xbin": Buffer.from("XBAGopaque", "ascii"),
    });
    const map = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });

    expect(map).toMatchObject({
      state: "blocked",
      files: [],
      gaps: [],
      summary: {
        receiptFileCount: 3,
        representedFileCount: 0,
        factsEstablishedCount: 0,
        affectedSourceCount: 1,
      },
      blockedReason: {
        code: "XGRIDS_XBIN_BLOCKED",
        affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
      },
    });
    expect(map.lanes).toHaveLength(FOUNDRY_SOURCE_READINESS_LANE_IDS.length);
    expect(map.lanes.every((lane) =>
      lane.status === "blocked" &&
      lane.representedSources.length === 0 &&
      lane.unknowns.length === 0
    )).toBe(true);
    const serialized = serializeFoundrySourceReadinessMapV1(map);
    expect(serialized).not.toContain("open.obj");
    expect(serialized).not.toContain("survey.e57");
    expect(serialized).toContain("vendor.xbin");
  });

  it("rejects cross-receipt substitution, source identity drift, hidden targets, and map tampering", async () => {
    const first = await inspect({
      "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
      "survey.e57": e57Fixture(),
    });
    const second = await inspect({
      "scene.obj": "v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n",
      "survey.e57": e57Fixture(),
    });
    expect(() => compileFoundrySourceReadinessMapV1({
      receipt: first.receipt,
      sourceFacts: second.sourceFacts,
    })).toThrow("does not bind the supplied intake receipt");

    if (first.sourceFacts.state !== "available") throw new Error("expected available Source Facts");
    const identityDrift = reissueSourceFacts(first.sourceFacts, (draft) => {
      const asset = draft.assets[0];
      if (asset === undefined) throw new Error("test fixture has no Source Facts asset");
      asset.source.sha256 = "f".repeat(64);
    });
    expect(() => compileFoundrySourceReadinessMapV1({
      receipt: first.receipt,
      sourceFacts: identityDrift,
    })).toThrow("identity does not match receipt file");

    const hiddenTarget = reissueSourceFacts(first.sourceFacts, (draft) => {
      const removed = draft.assets.shift();
      if (removed === undefined) throw new Error("test fixture has no Source Facts target to hide");
      if (removed.inspection.state === "established") draft.summary.establishedCount -= 1;
      else draft.summary.factsNotEstablishedCount -= 1;
      draft.summary.assetCount -= 1;
      draft.summary.untargetedFileCount += 1;
    });
    expect(() => compileFoundrySourceReadinessMapV1({
      receipt: first.receipt,
      sourceFacts: hiddenTarget,
    })).toThrow("omits required target");

    const map = compileFoundrySourceReadinessMapV1({
      receipt: first.receipt,
      sourceFacts: first.sourceFacts,
    });
    expect(FoundrySourceReadinessMapV1Schema.safeParse({
      ...map,
      readinessSha256: "0".repeat(64),
    }).success).toBe(false);
    expect(FoundrySourceReadinessMapV1Schema.safeParse(reissueReadiness(map, (draft) => {
      draft.lanes.reverse();
    })).success).toBe(false);
    expect(FoundrySourceReadinessMapV1Schema.safeParse(reissueReadiness(map, (draft) => {
      draft.summary.factsEstablishedCount += 1;
    })).success).toBe(false);
  });

  it("rejects re-digested duplicate, detection, blocked-count, and unknown contradictions", async () => {
    const duplicateInspected = await inspect({
      "a.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
      "b.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    const duplicateMap = compileFoundrySourceReadinessMapV1({
      receipt: duplicateInspected.receipt,
      sourceFacts: duplicateInspected.sourceFacts,
    });
    const falseUnique = reissueReadiness(duplicateMap, (draft) => {
      for (const file of draft.files) {
        file.duplicate = { status: "unique", groupSha256: null };
      }
    });
    expect(FoundrySourceReadinessMapV1Schema.safeParse(falseUnique).success).toBe(false);

    const established = await inspect({ "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" });
    const establishedMap = compileFoundrySourceReadinessMapV1({
      receipt: established.receipt,
      sourceFacts: established.sourceFacts,
    });
    const hiddenDetection = reissueReadiness(establishedMap, (draft) => {
      const file = draft.files[0];
      if (file === undefined) throw new Error("test fixture has no readiness file");
      file.detection = { status: "unknown", candidates: [], caveats: [] };
    });
    expect(FoundrySourceReadinessMapV1Schema.safeParse(hiddenDetection).success).toBe(false);

    const blockedInspected = await inspect({ "vendor.xbin": Buffer.from("XBAGopaque", "ascii") });
    const blockedMap = compileFoundrySourceReadinessMapV1({
      receipt: blockedInspected.receipt,
      sourceFacts: blockedInspected.sourceFacts,
    });
    const impossibleBlockedCount = reissueReadiness(blockedMap, (draft) => {
      draft.summary.receiptFileCount = 0;
    });
    expect(FoundrySourceReadinessMapV1Schema.safeParse(impossibleBlockedCount).success).toBe(false);

    const conflictingInspected = await inspect({
      "mesh.glb": glbFixture(),
      "mesh.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    const conflictingMap = compileFoundrySourceReadinessMapV1({
      receipt: conflictingInspected.receipt,
      sourceFacts: conflictingInspected.sourceFacts,
    });
    const contradictoryUnknown = reissueReadiness(conflictingMap, (draft) => {
      const glb = draft.files.find((file) => file.path === "mesh.glb");
      const obj = draft.files.find((file) => file.path === "mesh.obj");
      if (glb === undefined || obj === undefined || glb.unknowns[0] === undefined || obj.unknowns[0] === undefined) {
        throw new Error("test fixture lacks format unknowns");
      }
      obj.unknowns[0].code = glb.unknowns[0].code;
    });
    expect(() => FoundrySourceReadinessMapV1Schema.safeParse(contradictoryUnknown)).not.toThrow();
    expect(FoundrySourceReadinessMapV1Schema.safeParse(contradictoryUnknown).success).toBe(false);
  });

  it("strictly rejects injected operational fields at every artifact layer", async () => {
    const inspected = await inspect({
      "notes.opaque": "unknown\n",
      "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    const available = compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    });

    const topLevel = reissueReadiness(available, (draft) => {
      injectUnexpectedField(draft, "jobSpec", { stages: [] });
    });
    const fileLevel = reissueReadiness(available, (draft) => {
      const file = draft.files[0];
      if (file === undefined) throw new Error("test fixture has no readiness file");
      injectUnexpectedField(file, "workerProfile", "local");
    });
    const laneLevel = reissueReadiness(available, (draft) => {
      const lane = draft.lanes[0];
      if (lane === undefined) throw new Error("test fixture has no readiness lane");
      injectUnexpectedField(lane, "routeDecision", "selected");
    });
    const gapLevel = reissueReadiness(available, (draft) => {
      const gap = draft.gaps[0];
      if (gap === undefined) throw new Error("test fixture has no readiness gap");
      injectUnexpectedField(gap, "recipe", { id: "unexpected" });
    });

    const blockedInspected = await inspect({ "vendor.xbin": Buffer.from("XBAGopaque", "ascii") });
    const blocked = compileFoundrySourceReadinessMapV1({
      receipt: blockedInspected.receipt,
      sourceFacts: blockedInspected.sourceFacts,
    });
    const blockedReasonLevel = reissueReadiness(blocked, (draft) => {
      if (draft.blockedReason === null) throw new Error("test fixture has no blocked reason");
      injectUnexpectedField(draft.blockedReason, "providerSelectionResult", "unexpected");
    });

    for (const candidate of [
      topLevel,
      fileLevel,
      laneLevel,
      gapLevel,
      blockedReasonLevel,
    ]) {
      expect(FoundrySourceReadinessMapV1Schema.safeParse(candidate).success).toBe(false);
    }
  });
});
