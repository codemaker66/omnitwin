import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// twin-fixture — the synthetic twin/0 bundle every twin quality gate runs on.
//
// Four scans on floor 0 in a T shape: a straight run scan_000 → scan_001 →
// scan_002 along +X, with scan_003 branching off scan_001 toward −Y. Edges
// chain 000-001, 001-002, 001-003, so scan_001 is the junction and the
// minimap's arrow-key walk has both a "right" and a "down" neighbour.
//
// The manifest literal is pushed through TwinManifestSchema at module load:
// if the twin/0 schema drifts, importing this fixture fails loudly instead of
// letting the e2e suite chase a phantom viewer bug. Values are synthetic —
// identity quaternions (level tripod) and metre-round translations — never
// real capture data (real bundles are gitignored, plan Global Constraints).
//
// Consumers: e2e/twin-walk.spec.ts (Playwright network mocks),
// src/__tests__/twin-chunk-budget.test.ts (fixture validation), and
// src/__tests__/TwinPage.test.tsx (mode-control show/hide, Phase 2 Task 5).
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 11);
// mesh descriptor: …/2026-07-02-twin-phase2-dollhouse.md (Task 5).
// -----------------------------------------------------------------------------

const FIXTURE_WITHOUT_MESH = {
  schema: "twin/0",
  venueSlug: "trades-hall",
  name: "Trades Hall Glasgow",
  capture: { kind: "matterport-e57", scanCount: 4 },
  tier: "ops-grade-2cm",
  upAxis: "z",
  units: "m",
  faces: ["front", "back", "left", "right", "up", "down"],
  lods: [256, 1024],
  generatedAt: "2026-07-02T12:00:00.000Z",
  nodes: [
    {
      id: "scan_000",
      index: 0,
      pose: { q: [1, 0, 0, 0], t: [0, 0, 1.5] },
      floor: 0,
      roomSlug: null,
    },
    {
      id: "scan_001",
      index: 1,
      pose: { q: [1, 0, 0, 0], t: [2.5, 0, 1.5] },
      floor: 0,
      roomSlug: null,
    },
    {
      id: "scan_002",
      index: 2,
      pose: { q: [1, 0, 0, 0], t: [5, 0, 1.5] },
      floor: 0,
      roomSlug: null,
    },
    {
      id: "scan_003",
      index: 3,
      pose: { q: [1, 0, 0, 0], t: [2.5, -2.5, 1.5] },
      floor: 0,
      roomSlug: null,
    },
  ],
  edges: [
    { a: "scan_000", b: "scan_001", distanceM: 2.5 },
    { a: "scan_001", b: "scan_002", distanceM: 2.5 },
    { a: "scan_001", b: "scan_003", distanceM: 2.5 },
  ],
};

export const TWIN_FIXTURE_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  ...FIXTURE_WITHOUT_MESH,
  // The mesh descriptor mirrors the REAL bundle's shape (Phase 2, Task 3) so
  // the mode control and dollhouse gates exercise the mesh-backed path; the
  // e2e routes mesh/dollhouse.glb to a byte fixture (Task 8), never real bytes.
  mesh: { path: "mesh/dollhouse.glb", bytes: 7158232, sourceName: "trades-hall-web.glb" },
});

/**
 * The same bundle WITHOUT a mesh — twin/0 keeps `mesh` optional, and the
 * viewer must hide the dollhouse/plan modes entirely for bundles like this.
 */
export const TWIN_FIXTURE_MANIFEST_NO_MESH: TwinManifest =
  TwinManifestSchema.parse(FIXTURE_WITHOUT_MESH);

/**
 * A structurally valid 1×1 lossy WebP (RIFF/WEBP/VP8 , 44 bytes) served for
 * every tile request in the e2e suite — the viewer streams and decodes it
 * exactly like a real tile, without any real capture bytes in the repo.
 */
export const TWIN_FIXTURE_TILE_DATA_URI =
  "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
