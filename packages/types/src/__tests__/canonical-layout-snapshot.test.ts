import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  CANONICAL_LAYOUT_SNAPSHOT_V0_SCHEMA_VERSION,
  CanonicalLayoutSnapshotV0Schema,
  canonicalLayoutSnapshotDigest,
  canonicalLayoutSnapshotJson,
  normalizeCanonicalLayoutSnapshot,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalLayoutSnapshotV0,
} from "../canonical-layout-snapshot.js";

describe("Canonical Layout Snapshot v0", () => {
  it("parses the canonical fixture", () => {
    expect(CanonicalLayoutSnapshotV0Schema.parse(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE))
      .toEqual(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE);
    expect(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.schemaVersion).toBe(
      CANONICAL_LAYOUT_SNAPSHOT_V0_SCHEMA_VERSION,
    );
  });

  it("implements deterministic canonical JSON with sorted object keys and ordered arrays", () => {
    expect(stableCanonicalJson({ b: 1, a: 2, c: [3, 2, 1] })).toBe(
      "{\"a\":2,\"b\":1,\"c\":[3,2,1]}",
    );
    expect(stableCanonicalJson([{ z: true, a: false }, "next"])).toBe(
      "[{\"a\":false,\"z\":true},\"next\"]",
    );
  });

  it("implements SHA-256 without a Node crypto dependency", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("normalizes documented unordered arrays and canonical pose precision", () => {
    const normalized = normalizeCanonicalLayoutSnapshot(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE);

    expect(normalized.objects.map((object) => object.objectId)).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "77777777-7777-4777-8777-777777777777",
    ]);
    expect(normalized.objects[0]?.position).toEqual({ x: 5.123, y: 0, z: 4.988 });
    expect(normalized.objects[0]?.rotation).toEqual({ x: 0, y: 0.12346, z: 0 });
    expect(normalized.objects[0]?.scale).toBe(1);
    expect(normalized.scenarioAssumptions.map((assumption) => assumption.category)).toEqual([
      "guest_count",
      "seating_style",
    ]);
  });

  it("keeps the digest stable across object and assumption input ordering", () => {
    const reordered: CanonicalLayoutSnapshotV0 = {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      objects: [...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects].reverse(),
      scenarioAssumptions: [
        ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.scenarioAssumptions,
      ].reverse(),
    };

    expect(canonicalLayoutSnapshotJson(reordered)).toBe(
      canonicalLayoutSnapshotJson(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE),
    );
    expect(canonicalLayoutSnapshotDigest(reordered)).toBe(
      canonicalLayoutSnapshotDigest(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE),
    );
  });

  it("preserves floor-plan polygon vertex order in the digest", () => {
    const reversedOutline: CanonicalLayoutSnapshotV0 = {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      venueRuntime: {
        ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
        floorPlanOutline: [
          ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime.floorPlanOutline,
        ].reverse(),
      },
    };

    expect(canonicalLayoutSnapshotDigest(reversedOutline)).not.toBe(
      canonicalLayoutSnapshotDigest(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE),
    );
  });

  it("rejects temporary planner state and digest self-inclusion", () => {
    expect(CanonicalLayoutSnapshotV0Schema.safeParse({
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      sourceState: "dirty_editor_state",
    }).success).toBe(false);

    expect(CanonicalLayoutSnapshotV0Schema.safeParse({
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      objects: [
        {
          ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[0],
          objectId: "local-1",
        },
      ],
    }).success).toBe(false);

    expect(CanonicalLayoutSnapshotV0Schema.safeParse({
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      layoutDigest: "a".repeat(64),
    }).success).toBe(false);
  });
});
