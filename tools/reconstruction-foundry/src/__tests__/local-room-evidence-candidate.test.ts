import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import {
  GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_SHA256,
  GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_STATEMENT,
  ROOM_EVIDENCE_DIGEST_DOMAIN,
  canonicalRoomEvidenceJsonV0,
  compileRoomEvidenceCandidateDigestV0,
  localRoomEvidenceConsumerUrlV0,
  parseLocalRoomEvidenceRouteV0,
  projectGrandHallTwinPresentationManifestV0,
} from "../local-room-evidence-candidate.js";

function sourceTwin(): TwinManifest {
  const nodes = Array.from({ length: 149 }, (_, index) => ({
    id: `scan_${String(index).padStart(3, "0")}`,
    index,
    pose: { q: [1, 0, 0, 0] as const, t: [index, 0, 1.5] as const },
    floor: 0,
    roomSlug: null,
  }));
  const contentHashes: Record<string, string> = {
    "mesh/dollhouse.glb": "a".repeat(64),
  };
  for (const node of nodes) {
    for (const lod of [512, 4096, 8192]) {
      contentHashes[`tiles/${node.id}/equirect_${String(lod)}.webp`] =
        createHash("sha256")
          .update(`${node.id}:${String(lod)}`)
          .digest("hex");
    }
  }
  return TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: "trades-hall",
    name: "Trades Hall Glasgow",
    capture: { kind: "matterport-e57", scanCount: 149 },
    tier: "ops-grade-2cm",
    upAxis: "z",
    units: "m",
    imagery: "equirect",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [512, 4096, 8192],
    generatedAt: "2026-07-10T23:20:46.000Z",
    nodes,
    edges: [
      { a: "scan_000", b: "scan_048", distanceM: 1 },
      { a: "scan_048", b: "scan_049", distanceM: 1 },
      { a: "scan_100", b: "scan_101", distanceM: 1 },
    ],
    entryNodeId: "scan_100",
    mesh: {
      path: "mesh/dollhouse.glb",
      bytes: 7_342_964,
      sourceName: "reviewed.glb",
    },
    contentHashes,
  });
}

describe("Grand Hall local room-evidence contract", () => {
  it("binds the exact broad owner authorization without making it operational authority", () => {
    expect(GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_STATEMENT).toContain(
      "all Venviewer product purposes",
    );
    expect(GRAND_HALL_ROOM_EVIDENCE_ATTESTATION_SHA256).toBe(
      "sha256:e8659e0c6e757a5bfd167b3b2abfa4ae729a44f5249fefe2cfcb0497d3d2c2cb",
    );
  });

  it("seals a URL-free profile with the documented domain and canonical ordering", () => {
    const left = { z: [2, 1], a: { y: true, x: "member" } };
    const right = { a: { x: "member", y: true }, z: [2, 1] };
    expect(canonicalRoomEvidenceJsonV0(left)).toBe(
      canonicalRoomEvidenceJsonV0(right),
    );
    expect(compileRoomEvidenceCandidateDigestV0(left)).toBe(
      compileRoomEvidenceCandidateDigestV0(right),
    );
    expect(ROOM_EVIDENCE_DIGEST_DOMAIN).toBe(
      "VENVIEWER_LOCAL_GRAND_HALL_ROOM_EVIDENCE_CANDIDATE_V0",
    );
    expect(
      compileRoomEvidenceCandidateDigestV0({
        ...left,
        ledger: { state: "inventory_only", reason: "technical_reason_a" },
      }),
    ).not.toBe(
      compileRoomEvidenceCandidateDigestV0({
        ...left,
        ledger: { state: "inventory_only", reason: "technical_reason_b" },
      }),
    );
  });

  it("projects only ordered scans 000..048, internal edges, 147 panos and one mesh", () => {
    const projected = projectGrandHallTwinPresentationManifestV0(sourceTwin());
    expect(projected.nodes).toHaveLength(49);
    expect(projected.nodes[0]?.id).toBe("scan_000");
    expect(projected.nodes[48]?.id).toBe("scan_048");
    expect(projected.capture).toEqual({
      kind: "matterport-e57",
      scanCount: 49,
    });
    expect(projected.edges).toEqual([
      { a: "scan_000", b: "scan_048", distanceM: 1 },
    ]);
    expect(projected.entryNodeId).toBe("scan_000");
    expect(Object.keys(projected.contentHashes ?? {})).toHaveLength(148);
    expect(projected.contentHashes).not.toHaveProperty(
      "tiles/scan_049/equirect_512.webp",
    );
    expect(projected.contentHashes).toHaveProperty("mesh/dollhouse.glb");
  });

  it("parses only exact descriptor, opaque member and path-lease routes", () => {
    const token = "a".repeat(43);
    expect(
      parseLocalRoomEvidenceRouteV0("/api/local-room-evidence-candidate"),
    ).toEqual({ kind: "descriptor" });
    expect(
      parseLocalRoomEvidenceRouteV0(
        "/api/local-room-evidence-candidate/members/preview-0.jpg",
      ),
    ).toEqual({ kind: "member", memberId: "preview-0", suffix: "jpg" });
    expect(
      parseLocalRoomEvidenceRouteV0(
        `/api/local-room-evidence-candidate/twin/${token}/tiles/scan_000/equirect_512.webp`,
      ),
    ).toEqual({
      kind: "twin",
      pathToken: token,
      relativePath: "tiles/scan_000/equirect_512.webp",
    });
    expect(
      parseLocalRoomEvidenceRouteV0(
        "/api/local-room-evidence-candidate/members/preview-0",
      ),
    ).toBeNull();
    expect(
      parseLocalRoomEvidenceRouteV0(
        `/api/local-room-evidence-candidate/twin/${token}/../manifest.json`,
      ),
    ).toBeNull();
  });

  it("builds the token-bearing consumer query without exposing a filesystem path", () => {
    const descriptor = `http://127.0.0.1:55982/api/local-room-evidence-candidate?token=${"a".repeat(43)}`;
    const url = new URL(
      localRoomEvidenceConsumerUrlV0("http://127.0.0.1:55983", descriptor),
    );
    expect(url.pathname).toBe("/dev/trades-hall-visual");
    expect(url.searchParams.get("localRoomEvidence")).toBe(descriptor);
    expect(url.toString()).not.toContain("C%3A");
  });
});
