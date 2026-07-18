import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { domainSeparatedSha256, toCanonicalJson } from "../canonical-json.js";
import { inspectUniversalIntakeWithSourceFacts } from "../intake-receipt.js";
import {
  FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DIGEST_DOMAIN,
  FoundryOperatorEvidenceChecklistV1Schema,
  compileFoundryOperatorEvidenceChecklistV1,
  serializeFoundryOperatorEvidenceChecklistV1,
  verifyFoundryOperatorEvidenceChecklistV1,
  type FoundryOperatorEvidenceChecklistV1,
} from "../operator-evidence-checklist.js";
import {
  FOUNDRY_SOURCE_READINESS_LANE_IDS,
  FOUNDRY_SOURCE_READINESS_MAP_DIGEST_DOMAIN,
  FoundrySourceReadinessMapV1Schema,
  compileFoundrySourceReadinessMapV1,
  type FoundrySourceReadinessMapV1,
} from "../source-readiness.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
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

function glbFixture(): Buffer {
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0", generator: "evidence-checklist-test" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      accessors: [{ count: 3, componentType: 5126, type: "VEC3" }],
      buffers: [{ byteLength: 0 }],
    }),
    "utf8",
  );
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

async function fixtureRoot(
  files: Readonly<Record<string, Uint8Array | string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foundry-evidence-checklist-"));
  cleanup.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, ...relativePath.split("/"));
    const parent = path.slice(
      0,
      Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")),
    );
    if (parent !== root) await mkdir(parent, { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

async function inspect(
  files: Readonly<Record<string, Uint8Array | string>>,
): Promise<{
  readonly root: string;
  readonly readiness: FoundrySourceReadinessMapV1;
}> {
  const root = await fixtureRoot(files);
  const inspected = await inspectUniversalIntakeWithSourceFacts(root);
  return {
    root,
    readiness: compileFoundrySourceReadinessMapV1({
      receipt: inspected.receipt,
      sourceFacts: inspected.sourceFacts,
    }),
  };
}

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

function reissueChecklist(
  value: FoundryOperatorEvidenceChecklistV1,
  mutate: (draft: Mutable<FoundryOperatorEvidenceChecklistV1>) => void,
): unknown {
  const draft = structuredClone(
    value,
  ) as Mutable<FoundryOperatorEvidenceChecklistV1>;
  mutate(draft);
  const { checklistSha256: _checklistSha256, ...payload } = draft;
  draft.checklistSha256 = domainSeparatedSha256(
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  return draft;
}

function reissueReadinessWithFutureUnknown(
  value: Extract<FoundrySourceReadinessMapV1, { readonly state: "available" }>,
): unknown {
  const draft = structuredClone(value) as Mutable<typeof value>;
  const file = draft.files.find((candidate) => candidate.path === "scene.obj");
  const lane = draft.lanes.find((candidate) => candidate.id === "mesh_geometry");
  const fileUnknown = file?.unknowns.find(
    (unknown) => unknown.code === "OBJ_UP_AXIS_UNKNOWN",
  );
  const laneUnknown = lane?.unknowns.find(
    (unknown) => unknown.code === "OBJ_UP_AXIS_UNKNOWN",
  );
  if (fileUnknown === undefined || laneUnknown === undefined) {
    throw new Error("test fixture lacks the expected OBJ unknown");
  }
  fileUnknown.code = "ZZZ_FUTURE_UNKNOWN";
  laneUnknown.code = "ZZZ_FUTURE_UNKNOWN";
  const { readinessSha256: _readinessSha256, ...payload } = draft;
  draft.readinessSha256 = domainSeparatedSha256(
    FOUNDRY_SOURCE_READINESS_MAP_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
  return draft;
}

function injectUnexpectedField(
  value: object,
  key: string,
  fieldValue: unknown,
): void {
  (value as Record<string, unknown>)[key] = fieldValue;
}

describe("Foundry Operator Evidence Checklist V1", () => {
  it("builds one deterministic request per readiness gap and source-fact unknown", async () => {
    const inspected = await inspect({
      "geometry/survey.e57": e57Fixture(),
      "geometry/shell.glb": glbFixture(),
      "geometry/shell.obj": "v 0 0 0\nv 2 0 0\nv 0 3 0\nf 1 2 3\n",
      "images/view.jpg": Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      "runtime/room.spz": Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
      "camera-calibration.yaml": "camera: pinhole\n",
      "notes.opaque": "operator notes\n",
    });
    const first = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    const second = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    if (first.state !== "available") throw new Error("expected an available checklist");
    if (inspected.readiness.state !== "available") throw new Error("expected available readiness");

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: "omnitwin.foundry.operator-evidence-checklist.v1",
      meaning: "pre_admission_operator_evidence_action_plan",
      basis: "exact_source_readiness_map",
      receiptSha256: inspected.readiness.receiptSha256,
      sourceFactsSha256: inspected.readiness.sourceFactsSha256,
      readinessSha256: inspected.readiness.readinessSha256,
      state: "available",
      policy: {
        sourceAccess: "read_only",
        mutation: "none",
        reconstruction: "none",
        networkAccess: "none",
        requestPerformance: "none",
        completionTracking: "none",
        desiredOutputProfile: "not_bound",
        prioritization: "evidence_dependency_only",
        necessity: "not_evaluated",
        admission: "not_evaluated",
        routeCompilation: "none",
        recipeCompilation: "none",
        workerSelection: "none",
        providerSelection: "none",
        execution: "not_authorized",
        authority: "none",
      },
      summary: {
        receiptFileCount: 7,
        evidenceRequestCount: 28,
        groupCount: 3,
        blockingCount: 0,
        highCount: 3,
        normalCount: 24,
        conditionalCount: 1,
        affectedSourceCount: 7,
        distinctContentCount: 7,
        affectedLaneCount: 8,
      },
    });

    const originCodes = new Set([
      ...inspected.readiness.gaps.map((gap) => gap.code),
      ...inspected.readiness.files.flatMap((file) =>
        file.unknowns.map((unknown) => unknown.code),
      ),
    ]);
    expect(new Set(first.items.map((item) => item.evidenceCode))).toEqual(
      originCodes,
    );
    expect(first.items).toHaveLength(originCodes.size);
    expect(
      Object.fromEntries(
        first.items.map((item) => [
          item.evidenceCode,
          `${item.category}:${item.evidencePriority}`,
        ]),
      ),
    ).toEqual({
      AMBIGUOUS_FORMAT: "format_identification:high",
      E57_ACCURACY_UNKNOWN: "independent_control:normal",
      E57_BOUNDS_UNKNOWN: "bounded_inspection:normal",
      E57_CRS_UNKNOWN: "registration_input:normal",
      E57_IMAGE_COUNT_UNKNOWN: "bounded_inspection:normal",
      E57_POINT_COUNT_UNKNOWN: "bounded_inspection:normal",
      E57_REGISTRATION_UNKNOWN: "independent_control:normal",
      E57_RIGHTS_UNKNOWN: "rights_decision:normal",
      E57_SCAN_COUNT_UNKNOWN: "bounded_inspection:normal",
      E57_UNITS_UNKNOWN: "source_provenance:normal",
      GLB_ACCURACY_UNKNOWN: "independent_control:normal",
      GLB_APPEARANCE_FIDELITY_UNKNOWN: "appearance_reference:normal",
      GLB_DECODED_GEOMETRY_UNKNOWN: "bounded_inspection:normal",
      GLB_FRAME_UNKNOWN: "registration_input:normal",
      GLB_REMAINING_CHUNKS_UNKNOWN: "bounded_inspection:normal",
      GLB_RIGHTS_UNKNOWN: "rights_decision:normal",
      GLB_UNITS_UNKNOWN: "source_provenance:normal",
      NO_SOURCE_OBSERVED: "source_acquisition:conditional",
      OBJ_ACCURACY_UNKNOWN: "independent_control:normal",
      OBJ_FRAME_UNKNOWN: "registration_input:normal",
      OBJ_MATERIAL_COMPLETENESS_UNKNOWN: "bounded_inspection:normal",
      OBJ_RIGHTS_UNKNOWN: "rights_decision:normal",
      OBJ_TOPOLOGY_UNKNOWN: "bounded_inspection:normal",
      OBJ_TRIANGULATION_UNKNOWN: "bounded_inspection:normal",
      OBJ_UNITS_UNKNOWN: "source_provenance:normal",
      OBJ_UP_AXIS_UNKNOWN: "source_provenance:normal",
      OUTSIDE_SOURCE_FACTS_V1: "bounded_inspection:high",
      UNCLASSIFIED_FORMAT: "format_identification:high",
    });
    expect(
      Object.fromEntries(
        [
          "source_acquisition",
          "format_identification",
          "bounded_inspection",
          "source_provenance",
          "registration_input",
          "independent_control",
          "rights_decision",
          "appearance_reference",
        ].map((category) => [
          category,
          first.items.filter((item) => item.category === category).length,
        ]),
      ),
    ).toEqual({
      source_acquisition: 1,
      format_identification: 2,
      bounded_inspection: 10,
      source_provenance: 4,
      registration_input: 3,
      independent_control: 4,
      rights_decision: 3,
      appearance_reference: 1,
    });

    const noSource = first.items.find(
      (item) => item.evidenceCode === "NO_SOURCE_OBSERVED",
    );
    expect(noSource).toMatchObject({
      category: "source_acquisition",
      evidencePriority: "conditional",
      completionEvidenceKind: "source_scope_decision_record",
      necessity: "not_evaluated",
      affectedSources: [],
    });
    expect(noSource?.completionEvidenceRequirements).toEqual(
      expect.arrayContaining([
        "A desired-output scope decision identifies which, if any, listed source-family lanes are applicable and records every not-needed or non-applicable lane explicitly.",
        "For each selected lane, a new exact intake receipt represents that lane; selecting no lane is a valid outcome.",
      ]),
    );
    expect(noSource?.requestedEvidence).toContain(
      "First bind a desired-output scope",
    );
    expect(
      first.items.find(
        (item) => item.evidenceCode === "GLB_DECODED_GEOMETRY_UNKNOWN",
      )?.completionEvidenceRequirements,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("item's exact requested-evidence test"),
        expect.stringContaining(
          "unresolved result is valid only after the exact requested-evidence test was attempted",
        ),
      ]),
    );
    expect(
      first.items.find((item) => item.evidenceCode === "GLB_UNITS_UNKNOWN")
        ?.completionEvidenceRequirements,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("known-dimension verification"),
        expect.stringContaining(
          "unresolved result is valid only after the exact requested-evidence test was attempted",
        ),
      ]),
    );
    const outside = first.items.find(
      (item) => item.evidenceCode === "OUTSIDE_SOURCE_FACTS_V1",
    );
    expect(outside?.affectedSources.map((source) => source.path)).toEqual([
      "camera-calibration.yaml",
      "runtime/room.spz",
    ]);
    expect(
      outside?.affectedSources.map((source) => [source.path, source.laneIds]),
    ).toEqual([
      ["camera-calibration.yaml", ["registration_and_control"]],
      ["runtime/room.spz", ["visual_scene_representation"]],
    ]);
    expect(
      first.items.find((item) => item.evidenceCode === "UNCLASSIFIED_FORMAT")
        ?.completionEvidenceRequirements,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("item's exact requested-evidence test"),
        expect.stringContaining(
          "unresolved result is valid only after the exact requested-evidence test was attempted",
        ),
      ]),
    );
    expect(
      first.items.every(
        (item) =>
          item.completionEvidenceRequirements.length >= 2 &&
          item.completionLimits.length > 0,
      ),
    ).toBe(true);

    const serialized = serializeFoundryOperatorEvidenceChecklistV1(first);
    expect(serialized).toBe(
      serializeFoundryOperatorEvidenceChecklistV1(second),
    );
    expect(serialized).not.toContain(inspected.root);
    expect(serialized).not.toContain("createdAt");
    expect(serialized).not.toMatch(
      /"(?:jobSpec|workerProfile|providerRecommendation|command|routeRoles)"/u,
    );
    expect(serialized).not.toMatch(/\b(?:supported|processable|eligible)\b/iu);
  });

  it("treats every absent family as one conditional opportunity, never a requirement", async () => {
    const inspected = await inspect({});
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    if (checklist.state !== "available") throw new Error("expected an available checklist");

    expect(checklist.items).toEqual([
      expect.objectContaining({
        evidenceCode: "NO_SOURCE_OBSERVED",
        category: "source_acquisition",
        evidencePriority: "conditional",
        necessity: "not_evaluated",
        laneIds: FOUNDRY_SOURCE_READINESS_LANE_IDS,
        affectedSources: [],
      }),
    ]);
    expect(checklist.groups).toEqual([
      expect.objectContaining({
        id: "conditional_source_opportunities",
        itemIds: ["source_acquisition:NO_SOURCE_OBSERVED"],
      }),
    ]);
    expect(checklist.summary).toMatchObject({
      receiptFileCount: 0,
      evidenceRequestCount: 1,
      highCount: 0,
      normalCount: 0,
      conditionalCount: 1,
      affectedSourceCount: 0,
      affectedLaneCount: 8,
    });
  });

  it("preserves exact inspection failures inside the grouped foundational request", async () => {
    const inspected = await inspect({
      "broken.e57": Buffer.from("ASTM-E57", "ascii"),
      "scene.gltf": "{}",
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    if (checklist.state !== "available") throw new Error("expected an available checklist");
    const request = checklist.items.find(
      (item) => item.evidenceCode === "SOURCE_FACTS_NOT_ESTABLISHED",
    );

    expect(request).toMatchObject({
      category: "bounded_inspection",
      evidencePriority: "high",
      affectedSources: [
        {
          path: "broken.e57",
          readinessStatus: "facts_not_established",
          inspection: {
            state: "facts_not_established",
            category: "parse_failure",
            code: "E57_PHYSICAL_HEADER_TRUNCATED",
            coverage: "none",
          },
        },
        {
          path: "scene.gltf",
          readinessStatus: "facts_not_established",
          inspection: {
            state: "facts_not_established",
            category: "unsupported_variant",
            code: "GLTF_JSON_VARIANT_UNSUPPORTED",
            coverage: "none",
          },
        },
      ],
    });
    expect(request?.evidenceCode).toBe("SOURCE_FACTS_NOT_ESTABLISHED");
    expect(request?.completionEvidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("item's exact requested-evidence test"),
      ]),
    );
  });

  it("preserves every candidate lane for ambiguous multi-family evidence", async () => {
    const inspected = await inspect({
      "calibration.ifc": "ISO-10303-21;\nEND-ISO-10303-21;\n",
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    if (checklist.state !== "available") throw new Error("expected an available checklist");

    expect(
      checklist.items.find(
        (item) => item.evidenceCode === "AMBIGUOUS_FORMAT",
      ),
    ).toMatchObject({
      category: "format_identification",
      evidencePriority: "high",
      laneIds: [
        "mesh_geometry",
        "registration_and_control",
        "vendor_or_opaque_package",
      ],
      affectedSources: [{ path: "calibration.ifc" }],
    });
  });

  it("preserves duplicate paths but counts identical bytes once", async () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    const inspected = await inspect({ "a.obj": obj, "nested/b.obj": obj });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });
    if (checklist.state !== "available") throw new Error("expected an available checklist");
    const topology = checklist.items.find(
      (item) => item.evidenceCode === "OBJ_TOPOLOGY_UNKNOWN",
    );

    expect(topology?.affectedSources.map((source) => source.path)).toEqual([
      "a.obj",
      "nested/b.obj",
    ]);
    expect(
      topology?.affectedSources.every(
        (source) => source.duplicate.status === "exact_content_duplicate",
      ),
    ).toBe(true);
    expect(checklist.summary).toMatchObject({
      affectedSourceCount: 2,
      distinctContentCount: 1,
    });
  });

  it("keeps XBIN atomic with one official-export blocker and no ordinary item", async () => {
    const inspected = await inspect({
      "open.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
      "survey.e57": e57Fixture(),
      "vendor.xbin": Buffer.from("XBAGopaque", "ascii"),
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: inspected.readiness,
    });

    expect(checklist).toMatchObject({
      state: "blocked",
      groups: [],
      items: [],
      summary: {
        receiptFileCount: 3,
        evidenceRequestCount: 1,
        blockingCount: 1,
        affectedSourceCount: 1,
      },
      blockedReason: {
        code: "XGRIDS_XBIN_BLOCKED",
        category: "official_export",
        evidencePriority: "blocking",
        affectedSources: [{ path: "vendor.xbin", inputType: "xgrids_xbin" }],
      },
    });
    const serialized = serializeFoundryOperatorEvidenceChecklistV1(checklist);
    expect(serialized).toContain("vendor.xbin");
    expect(serialized).not.toContain("open.obj");
    expect(serialized).not.toContain("survey.e57");

    const substitutedBlockedSource = reissueChecklist(checklist, (draft) => {
      if (draft.state !== "blocked") throw new Error("expected blocked draft");
      const source = draft.blockedReason.affectedSources[0];
      if (source === undefined) throw new Error("test fixture has no blocked source");
      source.sha256 = "f".repeat(64);
    });
    expect(
      FoundryOperatorEvidenceChecklistV1Schema.safeParse(
        substitutedBlockedSource,
      ).success,
    ).toBe(true);
    expect(() =>
      verifyFoundryOperatorEvidenceChecklistV1({
        readiness: inspected.readiness,
        checklist: substitutedBlockedSource,
      }),
    ).toThrow("does not exactly match");
  });

  it("fails closed when Source Readiness introduces an unreviewed evidence code", async () => {
    const inspected = await inspect({
      "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    if (inspected.readiness.state !== "available") {
      throw new Error("expected available readiness");
    }
    const futureReadiness = reissueReadinessWithFutureUnknown(
      inspected.readiness,
    );
    expect(FoundrySourceReadinessMapV1Schema.safeParse(futureReadiness).success).toBe(
      true,
    );
    expect(() =>
      compileFoundryOperatorEvidenceChecklistV1({
        readiness: futureReadiness,
      }),
    ).toThrow("has no reviewed checklist mapping");
  });

  it("verifies the exact upstream derivation and rejects re-digested tampering", async () => {
    const first = await inspect({
      "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    const second = await inspect({
      "scene.obj": "v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n",
    });
    const checklist = compileFoundryOperatorEvidenceChecklistV1({
      readiness: first.readiness,
    });
    expect(
      verifyFoundryOperatorEvidenceChecklistV1({
        readiness: first.readiness,
        checklist,
      }),
    ).toEqual(checklist);
    expect(() =>
      verifyFoundryOperatorEvidenceChecklistV1({
        readiness: second.readiness,
        checklist,
      }),
    ).toThrow("does not exactly match");
    if (checklist.state !== "available") throw new Error("expected available checklist");

    const sourceIdentityDrift = reissueChecklist(checklist, (draft) => {
      if (draft.state !== "available") throw new Error("expected available draft");
      let changed = false;
      for (const item of draft.items) {
        for (const source of item.affectedSources) {
          if (source.path !== "scene.obj") continue;
          source.sha256 = "f".repeat(64);
          changed = true;
        }
      }
      if (!changed) throw new Error("test fixture has no source ref");
    });
    expect(
      FoundryOperatorEvidenceChecklistV1Schema.safeParse(sourceIdentityDrift)
        .success,
    ).toBe(true);
    expect(() =>
      verifyFoundryOperatorEvidenceChecklistV1({
        readiness: first.readiness,
        checklist: sourceIdentityDrift,
      }),
    ).toThrow("does not exactly match");

    const alteredRequirement = reissueChecklist(checklist, (draft) => {
      if (draft.state !== "available") throw new Error("expected available draft");
      const item = draft.items[0];
      if (item === undefined) throw new Error("test fixture has no item");
      item.completionEvidenceRequirements[0] = "Invented completion evidence";
    });
    expect(
      FoundryOperatorEvidenceChecklistV1Schema.safeParse(alteredRequirement)
        .success,
    ).toBe(false);

    const reordered = reissueChecklist(checklist, (draft) => {
      if (draft.state !== "available") throw new Error("expected available draft");
      draft.items.reverse();
    });
    expect(
      FoundryOperatorEvidenceChecklistV1Schema.safeParse(reordered).success,
    ).toBe(false);
  });

  it("strictly rejects injected operational or mutable-completion fields", async () => {
    const availableInspected = await inspect({
      "scene.obj": "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
    });
    const available = compileFoundryOperatorEvidenceChecklistV1({
      readiness: availableInspected.readiness,
    });
    if (available.state !== "available") throw new Error("expected available checklist");
    const blockedInspected = await inspect({
      "vendor.xbin": Buffer.from("XBAGopaque", "ascii"),
    });
    const blocked = compileFoundryOperatorEvidenceChecklistV1({
      readiness: blockedInspected.readiness,
    });

    const candidates = [
      reissueChecklist(available, (draft) => {
        injectUnexpectedField(draft, "jobSpec", {});
      }),
      reissueChecklist(available, (draft) => {
        if (draft.state !== "available") throw new Error("expected available draft");
        const item = draft.items[0];
        if (item === undefined) throw new Error("test fixture has no item");
        injectUnexpectedField(item, "completed", true);
      }),
      reissueChecklist(available, (draft) => {
        if (draft.state !== "available") throw new Error("expected available draft");
        const group = draft.groups[0];
        if (group === undefined) throw new Error("test fixture has no group");
        injectUnexpectedField(group, "worker", "local");
      }),
      reissueChecklist(blocked, (draft) => {
        if (draft.state !== "blocked") throw new Error("expected blocked draft");
        injectUnexpectedField(draft.blockedReason, "provider", "external");
      }),
    ];
    for (const candidate of candidates) {
      expect(
        FoundryOperatorEvidenceChecklistV1Schema.safeParse(candidate).success,
      ).toBe(false);
    }
  });
});
