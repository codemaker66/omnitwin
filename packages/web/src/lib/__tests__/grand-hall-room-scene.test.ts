import { describe, expect, it } from "vitest";
import { ROOM_SCENE_LAYER_KINDS } from "@omnitwin/types";
import {
  GRAND_HALL_ROOM_SCENE_MANIFEST_ID,
  createGrandHallRoomSceneManifest,
} from "../grand-hall-room-scene.js";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  GRAND_HALL_CAPTURED_SOURCE,
} from "../grand-hall-captured-source.js";
import {
  GRAND_HALL_NAVIGATION_PROFILE,
  GRAND_HALL_NAVIGATION_PROFILE_SHA256,
} from "../grand-hall-navigation-profile.js";

const PACKAGE_ID = "22222222-2222-4222-8222-222222222222";

describe("createGrandHallRoomSceneManifest", () => {
  it("adapts the immutable eleven-member frontier into one atomic CAPTURED appearance layer", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID);
    const visual = manifest.visualAssetManifests[0];

    expect(manifest.manifestId).toBe(GRAND_HALL_ROOM_SCENE_MANIFEST_ID);
    expect(manifest.runtimePackageId).toBe(PACKAGE_ID);
    expect(visual?.members).toHaveLength(GRAND_HALL_CAPTURED_SOG_MEMBERS.length);
    expect(visual?.totalBytes).toBe(GRAND_HALL_CAPTURED_SOURCE.totalBytes);
    expect(visual?.totalGaussianCount).toBe(GRAND_HALL_CAPTURED_SOURCE.gaussianCount);
    expect(manifest.layerDescriptors[0]).toMatchObject({
      id: "grand-hall-captured-appearance",
      kind: "Appearance",
      truthClass: "CAPTURED",
      authorities: ["appearance"],
      spatialRegistration: {
        type: "inspection_placement",
        bindingRef: "grand-hall-source-inspection-transform-v1",
      },
      loadPolicy: "atomic",
    });
    expect(manifest.layerDescriptors[1]?.spatialRegistration).toEqual(
      manifest.layerDescriptors[0]?.spatialRegistration,
    );
  });

  it("registers only real current layers and omits unsupported compositor slots", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID);
    const kinds = manifest.layerDescriptors.map((layer) => layer.kind);

    expect(kinds).toEqual(["Appearance", "StructuralProxy"]);
    expect(ROOM_SCENE_LAYER_KINDS.filter((kind) => !kinds.includes(kind))).toEqual([
      "Collision",
      "HeroVolume",
      "Semantic",
      "Planner",
      "CinematicDerivative",
    ]);
  });

  it("labels the pose-envelope layer as a reconstructed diagnostic rather than a room shell", () => {
    const manifest = createGrandHallRoomSceneManifest(PACKAGE_ID);
    const proxy = manifest.layerDescriptors[1];
    const evidence = manifest.qualityEvidence.find(
      (item) => item.id === "grand-hall-source-envelope-diagnostic",
    );

    expect(proxy).toMatchObject({
      kind: "StructuralProxy",
      truthClass: "RECONSTRUCTED",
      authorities: ["diagnostic_navigation"],
      visibleByDefault: false,
    });
    expect(evidence?.limitations.join(" ")).toContain("not a room shell");
    expect(evidence?.limitations.join(" ")).toContain("not collision authority");
    expect(evidence?.evidenceRefs).toEqual([
      GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256,
      GRAND_HALL_NAVIGATION_PROFILE.source.sha256,
      GRAND_HALL_NAVIGATION_PROFILE.reconstructedMesh.sha256,
      GRAND_HALL_NAVIGATION_PROFILE_SHA256,
    ]);
    expect(proxy?.source).toMatchObject({ sha256: GRAND_HALL_NAVIGATION_PROFILE_SHA256 });
  });

  it("retains the owner-confirmed scope and pending documentary placeholder", () => {
    const rights = createGrandHallRoomSceneManifest(PACKAGE_ID).sourceRights[0];

    expect(rights?.authorityStatement).toBe("Authority status: confirmed by project owner");
    expect(rights?.scopeStatement).toBe(
      "Scope: data use, reconstruction, training, enhancement, derivatives, commercial Venviewer development, reverse engineering and software integration",
    );
    expect(rights?.evidenceLocation).toBe("PROJECT_EVIDENCE_STORE/PENDING_ATTACHMENT");
    expect(rights?.additionalPermissions).toEqual([
      "redistribution",
      "third_party_dissemination",
    ]);
    expect(rights?.unrelatedLicensesRequireSeparateReview).toBe(true);
  });
});
