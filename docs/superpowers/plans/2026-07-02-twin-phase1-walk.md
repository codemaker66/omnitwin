# Twin Phase 1 — The Walk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public pano walkthrough of Trades Hall — 149 posed scan points, look-around + click-to-move — at `/venues/:venueSlug/twin`, fed by a new `twin-forge` pipeline.

**Architecture:** Offline forge (Node/TS workspace tool) converts existing cubemap faces + poses.json into a `twin/0` bundle (WebP tiles at 2 LODs + manifest + nav graph + SHA-256 hashes). The viewer is a lazy R3F chunk: two cube-sampled spheres crossfade between nodes, springs drive look/dolly, all E57↔three.js basis math lives in one tested module.

**Tech Stack:** TypeScript strict, zod (@omnitwin/types), sharp (forge only), React Three Fiber + three (existing chunks), Vitest, Playwright.

## Global Constraints

- TypeScript strict, zero `any`, `noUncheckedIndexedAccess` (repo-wide).
- Springs, never tweens, for interactive motion (house rule).
- No Three.js on marketing routes; twin viewer is its own lazy chunk ≤ 250 KB gz (excl. shared three/react chunks).
- All user-visible twin copy passes `findUnsupportedProposalClaim` by test; measurement language is planning-grade.
- Public from day one ⇒ a11y (focus-visible, landmarks, contrast) + no horizontal overflow + graceful slow-network states are Phase-1 DoD, not polish.
- Real tiles/manifest are NEVER committed (`packages/web/public/twin/` is gitignored); tests use small fixtures.
- Manifest schema id is exactly `"twin/0"`; capture source is a discriminated union `matterport-e57 | xgrids-lcc | photo-mapanything` (spec §7.3).
- Data inputs (do not mutate): `F:\downloads (some very important)\E57\cubemaps\scan_NNN_{front,back,left,right,up,down}.jpg` (894 files), `F:\downloads (some very important)\E57\poses.json` (149 entries, `{q:[w,x,y,z] as "rotation", t as "translation"}`, E57 frame: Z-up, metres, +X scanner-forward).
- Vercel/pnpm gotchas: heap flags stay pinned per `.claude/gotchas/windows-v8-heap.md`; new vitest configs copy `pool:"forks"` + `--max-old-space-size=8192`.

---

### Task 1: `twin/0` schemas in @omnitwin/types

**Files:**
- Create: `packages/types/src/twin.ts`
- Modify: `packages/types/src/index.ts` (add `export * from "./twin.js";`)
- Test: `packages/types/src/__tests__/twin.test.ts`

**Interfaces:**
- Produces: `TwinPoseSchema`, `TwinScanNodeSchema`, `TwinNavEdgeSchema`, `TwinCaptureSourceSchema`, `TwinManifestSchema`, types `TwinPose`, `TwinScanNode`, `TwinNavEdge`, `TwinManifest`, `TwinCaptureSource`; constants `TWIN_SCHEMA_ID = "twin/0"`, `TWIN_FACES = ["front","back","left","right","up","down"] as const`, `TWIN_LODS = [256, 1024] as const`; helper `twinTilePath(nodeId, face, lod): string` returning `tiles/${nodeId}/${face}_${lod}.webp`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/types/src/__tests__/twin.test.ts
import { describe, expect, it } from "vitest";
import {
  TWIN_FACES,
  TWIN_LODS,
  TWIN_SCHEMA_ID,
  TwinManifestSchema,
  twinTilePath,
} from "../twin.js";

const validManifest = {
  schema: "twin/0",
  venueSlug: "trades-hall",
  name: "Trades Hall Glasgow",
  capture: { kind: "matterport-e57", scanCount: 149 },
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
      pose: {
        q: [0.7376939654350281, 0.014615842141211033, -0.011572370305657387, -0.6748778820037842],
        t: [0.004310831427574158, 0.008259806782007217, 1.4990558624267578],
      },
      floor: 0,
      roomSlug: null,
    },
  ],
  edges: [{ a: "scan_000", b: "scan_001", distanceM: 2.67 }],
};

describe("twin/0 manifest schema", () => {
  it("accepts a valid manifest", () => {
    expect(TwinManifestSchema.parse(validManifest).schema).toBe(TWIN_SCHEMA_ID);
  });

  it("rejects a wrong schema id", () => {
    expect(() => TwinManifestSchema.parse({ ...validManifest, schema: "twin/1" })).toThrow();
  });

  it("rejects a pose with wrong arity", () => {
    const bad = structuredClone(validManifest);
    bad.nodes[0].pose.q = [1, 0, 0];
    expect(() => TwinManifestSchema.parse(bad)).toThrow();
  });

  it("discriminates capture sources", () => {
    expect(
      TwinManifestSchema.parse({ ...validManifest, capture: { kind: "xgrids-lcc" } }).capture.kind,
    ).toBe("xgrids-lcc");
    expect(() =>
      TwinManifestSchema.parse({ ...validManifest, capture: { kind: "matterport" } }),
    ).toThrow();
  });

  it("builds tile paths", () => {
    expect(twinTilePath("scan_007", "front", 256)).toBe("tiles/scan_007/front_256.webp");
  });

  it("locks faces and lods", () => {
    expect(TWIN_FACES).toEqual(["front", "back", "left", "right", "up", "down"]);
    expect(TWIN_LODS).toEqual([256, 1024]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/twin.test.ts`
Expected: FAIL — `Cannot find module '../twin.js'`

- [ ] **Step 3: Write the implementation**

```ts
// packages/types/src/twin.ts
import { z } from "zod";

// -----------------------------------------------------------------------------
// twin/0 — the Venviewer Twin bundle manifest (spec:
// docs/superpowers/specs/2026-07-02-twin-program-design.md §4.2).
// Poses stay in the E57 capture frame (Z-up, metres, +X scanner-forward);
// basis conversion is the viewer's job (packages/web twin-basis).
// -----------------------------------------------------------------------------

export const TWIN_SCHEMA_ID = "twin/0" as const;
export const TWIN_FACES = ["front", "back", "left", "right", "up", "down"] as const;
export const TWIN_LODS = [256, 1024] as const;

export type TwinFace = (typeof TWIN_FACES)[number];
export type TwinLod = (typeof TWIN_LODS)[number];

export const TwinPoseSchema = z.object({
  /** Quaternion [w, x, y, z] — scanner→E57-world rotation, as captured. */
  q: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Translation [x, y, z] in metres, E57 world frame (Z-up). */
  t: z.tuple([z.number(), z.number(), z.number()]),
});
export type TwinPose = z.infer<typeof TwinPoseSchema>;

export const TwinScanNodeSchema = z.object({
  id: z.string().regex(/^scan_\d{3}$/),
  index: z.number().int().nonnegative(),
  pose: TwinPoseSchema,
  /** Floor bucket derived from pose height clusters; 0 = ground. */
  floor: z.number().int(),
  /** Link into the venue's room taxonomy when known; null until tagged. */
  roomSlug: z.string().nullable(),
});
export type TwinScanNode = z.infer<typeof TwinScanNodeSchema>;

export const TwinNavEdgeSchema = z.object({
  a: z.string(),
  b: z.string(),
  distanceM: z.number().positive(),
});
export type TwinNavEdge = z.infer<typeof TwinNavEdgeSchema>;

export const TwinCaptureSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("matterport-e57"), scanCount: z.number().int().positive() }),
  z.object({ kind: z.literal("xgrids-lcc") }),
  z.object({ kind: z.literal("photo-mapanything") }),
]);
export type TwinCaptureSource = z.infer<typeof TwinCaptureSourceSchema>;

export const TwinManifestSchema = z.object({
  schema: z.literal(TWIN_SCHEMA_ID),
  venueSlug: z.string().min(1),
  name: z.string().min(1),
  capture: TwinCaptureSourceSchema,
  /** ADR-015-aligned planning tier; never implies certification (ADR-012). */
  tier: z.enum(["survey-grade-1cm", "ops-grade-2cm", "planning-grade-5cm"]),
  upAxis: z.literal("z"),
  units: z.literal("m"),
  faces: z.tuple([
    z.literal("front"), z.literal("back"), z.literal("left"),
    z.literal("right"), z.literal("up"), z.literal("down"),
  ]),
  lods: z.tuple([z.literal(256), z.literal(1024)]),
  generatedAt: z.string().datetime(),
  nodes: z.array(TwinScanNodeSchema).min(1),
  edges: z.array(TwinNavEdgeSchema),
  /** SHA-256 per bundle entry, filled by twin-forge hash step (D-014 shape). */
  contentHashes: z.record(z.string(), z.string()).optional(),
});
export type TwinManifest = z.infer<typeof TwinManifestSchema>;

export function twinTilePath(nodeId: string, face: TwinFace, lod: TwinLod): string {
  return `tiles/${nodeId}/${face}_${String(lod)}.webp`;
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/types/src/index.ts`, add (alphabetical position near other modules):

```ts
export * from "./twin.js";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @omnitwin/types exec vitest run src/__tests__/twin.test.ts` → PASS (6 tests)
Run: `pnpm --filter @omnitwin/types build` → clean (needed so web/forge see the d.ts)

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/twin.ts packages/types/src/__tests__/twin.test.ts packages/types/src/index.ts
git commit -m "feat(types): twin/0 manifest schema - poses, nodes, nav edges, capture union"
```

---

### Task 2: twin-forge workspace tool — manifest + nav graph

**Files:**
- Create: `tools/twin-forge/package.json`, `tools/twin-forge/tsconfig.json`, `tools/twin-forge/vitest.config.ts`
- Create: `tools/twin-forge/src/build-manifest.ts`
- Create: `tools/twin-forge/src/nav-graph.ts`
- Test: `tools/twin-forge/src/__tests__/build-manifest.test.ts`, `tools/twin-forge/src/__tests__/nav-graph.test.ts`
- Modify: `pnpm-workspace.yaml` — packages list gains `- "tools/*"` (ONE line; do not touch anything else in that file — see session log 2026-07-01 for the corruption incident)

**Interfaces:**
- Consumes: `TwinManifestSchema`, `TwinScanNodeSchema`, types from `@omnitwin/types` (Task 1).
- Produces: `buildManifest(input: RawPoses, opts: ManifestOptions): TwinManifest` where `RawPoses = Record<string, { rotation: [number,number,number,number]; translation: [number,number,number] }>` (poses.json shape) and `ManifestOptions = { venueSlug: string; name: string; tier: TwinManifest["tier"]; generatedAt: string; nav?: NavGraphOptions }`; `buildNavGraph(nodes: TwinScanNode[], opts?: NavGraphOptions): TwinNavEdge[]` with `NavGraphOptions = { k?: number; maxDistanceM?: number; overrides?: { add?: [string,string][]; remove?: [string,string][] } }`; `floorOf(zMetres: number): number`.

- [ ] **Step 1: Scaffold the package**

`tools/twin-forge/package.json`:

```json
{
  "name": "@omnitwin/twin-forge",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "forge": "tsx src/cli.ts"
  },
  "dependencies": {
    "@omnitwin/types": "workspace:*",
    "sharp": "0.34.5"
  },
  "devDependencies": {
    "tsx": "4.20.6"
  }
}
```

Copy the exact `zod`, `typescript`, and `vitest` version pins from `packages/api/package.json` into dependencies/devDependencies (match the workspace, don't invent versions).

`tools/twin-forge/tsconfig.json`: copy `packages/api/tsconfig.json` and adjust `include` to `["src"]` (Node target, NodeNext modules, strict — match the api package exactly).

`tools/twin-forge/vitest.config.ts` — copy `packages/api/vitest.config.ts`'s heap-pinned config (pool forks + `--max-old-space-size=8192`, `singleFork: true`), environment `node`.

Add `- "tools/*"` to the `packages:` list in `pnpm-workspace.yaml`, run `pnpm install` from root, then **verify the yaml gained exactly one line** (`git diff pnpm-workspace.yaml` — the machine's pnpm once appended a corrupt duplicate `allowBuilds` block; revert any extra churn immediately).

- [ ] **Step 2: Write failing tests**

```ts
// tools/twin-forge/src/__tests__/nav-graph.test.ts
import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import { buildNavGraph, floorOf } from "../nav-graph.js";

function node(id: string, x: number, y: number, z = 1.5): TwinScanNode {
  return { id, index: Number(id.slice(5)), pose: { q: [1, 0, 0, 0], t: [x, y, z] }, floor: floorOf(z), roomSlug: null };
}

describe("buildNavGraph", () => {
  it("connects k nearest neighbours within range, symmetrically deduped", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_002", 4, 0), node("scan_003", 40, 0)];
    const edges = buildNavGraph(nodes, { k: 2, maxDistanceM: 8 });
    const pairs = edges.map((e) => `${e.a}-${e.b}`).sort();
    expect(pairs).toEqual(["scan_000-scan_001", "scan_000-scan_002", "scan_001-scan_002"]);
    expect(edges.every((e) => e.distanceM <= 8)).toBe(true);
  });

  it("never connects across floors", () => {
    const edges = buildNavGraph([node("scan_000", 0, 0, 1.5), node("scan_001", 1, 0, 6.5)], { k: 2, maxDistanceM: 8 });
    expect(edges).toEqual([]);
  });

  it("applies add/remove overrides", () => {
    const nodes = [node("scan_000", 0, 0), node("scan_001", 2, 0), node("scan_002", 100, 0)];
    const edges = buildNavGraph(nodes, {
      k: 1, maxDistanceM: 8,
      overrides: { add: [["scan_000", "scan_002"]], remove: [["scan_000", "scan_001"]] },
    });
    const pairs = edges.map((e) => `${e.a}-${e.b}`);
    expect(pairs).toContain("scan_000-scan_002");
    expect(pairs).not.toContain("scan_000-scan_001");
  });
});

describe("floorOf", () => {
  it("buckets tripod heights into floors (~3.5m storeys, tripod ≈1.5m)", () => {
    expect(floorOf(1.5)).toBe(0);
    expect(floorOf(6.4)).toBe(1);
    expect(floorOf(10.2)).toBe(2);
  });
});
```

```ts
// tools/twin-forge/src/__tests__/build-manifest.test.ts
import { describe, expect, it } from "vitest";
import { TwinManifestSchema } from "@omnitwin/types";
import { buildManifest } from "../build-manifest.js";

const rawPoses = {
  "0": { rotation: [0.73, 0.01, -0.01, -0.67] as [number, number, number, number], translation: [0, 0, 1.5] as [number, number, number] },
  "1": { rotation: [0.95, 0.0, -0.02, 0.29] as [number, number, number, number], translation: [0.15, -2.66, 1.49] as [number, number, number] },
};

describe("buildManifest", () => {
  it("emits a schema-valid twin/0 manifest with sorted scan ids", () => {
    const m = buildManifest(rawPoses, {
      venueSlug: "trades-hall", name: "Trades Hall Glasgow",
      tier: "ops-grade-2cm", generatedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(() => TwinManifestSchema.parse(m)).not.toThrow();
    expect(m.nodes.map((n) => n.id)).toEqual(["scan_000", "scan_001"]);
    expect(m.capture).toEqual({ kind: "matterport-e57", scanCount: 2 });
    expect(m.edges.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @omnitwin/twin-forge test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

```ts
// tools/twin-forge/src/nav-graph.ts
import type { TwinNavEdge, TwinScanNode } from "@omnitwin/types";

const STOREY_HEIGHT_M = 3.5;
const TRIPOD_HEIGHT_M = 1.5;

/** Bucket a scan height into a floor index (ground = 0). */
export function floorOf(zMetres: number): number {
  return Math.max(0, Math.round((zMetres - TRIPOD_HEIGHT_M) / STOREY_HEIGHT_M));
}

export interface NavGraphOptions {
  readonly k?: number;
  readonly maxDistanceM?: number;
  readonly overrides?: {
    readonly add?: readonly (readonly [string, string])[];
    readonly remove?: readonly (readonly [string, string])[];
  };
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function distance(a: TwinScanNode, b: TwinScanNode): number {
  const dx = a.pose.t[0] - b.pose.t[0];
  const dy = a.pose.t[1] - b.pose.t[1];
  const dz = a.pose.t[2] - b.pose.t[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * K-nearest-neighbour walk graph. Same-floor only (stairwell links are
 * exactly what the hand-edited overrides file is for), symmetric, deduped.
 */
export function buildNavGraph(
  nodes: readonly TwinScanNode[],
  opts: NavGraphOptions = {},
): TwinNavEdge[] {
  const k = opts.k ?? 4;
  const maxD = opts.maxDistanceM ?? 8;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chosen = new Map<string, TwinNavEdge>();

  for (const a of nodes) {
    const near = nodes
      .filter((b) => b.id !== a.id && b.floor === a.floor)
      .map((b) => ({ b, d: distance(a, b) }))
      .filter(({ d }) => d <= maxD)
      .sort((x, y) => x.d - y.d)
      .slice(0, k);
    for (const { b, d } of near) {
      const kk = key(a.id, b.id);
      if (!chosen.has(kk)) {
        const [idA, idB] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
        chosen.set(kk, { a: idA, b: idB, distanceM: Number(d.toFixed(3)) });
      }
    }
  }

  for (const [x, y] of opts.overrides?.remove ?? []) {
    chosen.delete(key(x, y));
  }
  for (const [x, y] of opts.overrides?.add ?? []) {
    const na = byId.get(x);
    const nb = byId.get(y);
    if (na === undefined || nb === undefined) {
      throw new Error(`nav override references unknown node: ${x} / ${y}`);
    }
    const [idA, idB] = x < y ? [x, y] : [y, x];
    chosen.set(key(x, y), { a: idA, b: idB, distanceM: Number(distance(na, nb).toFixed(3)) });
  }

  return [...chosen.values()].sort((e1, e2) => e1.a.localeCompare(e2.a) || e1.b.localeCompare(e2.b));
}
```

```ts
// tools/twin-forge/src/build-manifest.ts
import {
  TWIN_FACES,
  TWIN_LODS,
  TwinManifestSchema,
  type TwinManifest,
  type TwinScanNode,
} from "@omnitwin/types";
import { buildNavGraph, floorOf, type NavGraphOptions } from "./nav-graph.js";

export type RawPoses = Record<
  string,
  { rotation: [number, number, number, number]; translation: [number, number, number] }
>;

export interface ManifestOptions {
  readonly venueSlug: string;
  readonly name: string;
  readonly tier: TwinManifest["tier"];
  readonly generatedAt: string;
  readonly nav?: NavGraphOptions;
}

/** poses.json (E57-native) → schema-valid twin/0 manifest. */
export function buildManifest(raw: RawPoses, opts: ManifestOptions): TwinManifest {
  const nodes: TwinScanNode[] = Object.entries(raw)
    .map(([indexStr, pose]) => {
      const index = Number(indexStr);
      return {
        id: `scan_${String(index).padStart(3, "0")}`,
        index,
        pose: { q: pose.rotation, t: pose.translation },
        floor: floorOf(pose.translation[2]),
        roomSlug: null,
      };
    })
    .sort((a, b) => a.index - b.index);

  return TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: opts.venueSlug,
    name: opts.name,
    capture: { kind: "matterport-e57", scanCount: nodes.length },
    tier: opts.tier,
    upAxis: "z",
    units: "m",
    faces: [...TWIN_FACES],
    lods: [...TWIN_LODS],
    generatedAt: opts.generatedAt,
    nodes,
    edges: buildNavGraph(nodes, opts.nav),
  });
}
```

- [ ] **Step 5: Run tests + typecheck** → both PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/twin-forge pnpm-workspace.yaml
git commit -m "feat(twin-forge): manifest + KNN nav graph from E57 poses"
```

---

### Task 3: twin-forge — tiles (WebP, 2 LODs) + hashes + CLI

**Files:**
- Create: `tools/twin-forge/src/tiles.ts`, `tools/twin-forge/src/hashes.ts`, `tools/twin-forge/src/cli.ts`
- Test: `tools/twin-forge/src/__tests__/tiles.test.ts` (uses sharp to synthesize tiny JPGs in a temp dir)

**Interfaces:**
- Consumes: `twinTilePath`, `TWIN_FACES`, `TWIN_LODS` (Task 1).
- Produces: `convertTiles(cubemapsDir: string, outDir: string, nodeIds: string[], onProgress?: (done: number, total: number) => void): Promise<TileReport>` with `TileReport = { written: number; skipped: number; missing: string[] }`; `hashBundle(outDir: string): Promise<Record<string, string>>` (relative posix path → sha256 hex, excludes manifest.json); CLI `pnpm --filter @omnitwin/twin-forge forge -- --cubemaps <dir> --poses <file> --out <dir> --venue trades-hall --name "Trades Hall Glasgow" --tier ops-grade-2cm --overrides <file>`.

- [ ] **Step 1: Failing test**

```ts
// tools/twin-forge/src/__tests__/tiles.test.ts
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertTiles } from "../tiles.js";
import { hashBundle } from "../hashes.js";

async function makeFakeFace(dir: string, name: string): Promise<void> {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 160, b: 60 } } })
    .jpeg().toBuffer();
  writeFileSync(join(dir, name), buf);
}

describe("convertTiles", () => {
  it("writes 256+1024 webp per present face and reports missing ones", async () => {
    const src = mkdtempSync(join(tmpdir(), "forge-src-"));
    const out = mkdtempSync(join(tmpdir(), "forge-out-"));
    for (const face of ["front", "back", "left", "right", "up"]) {
      await makeFakeFace(src, `scan_000_${face}.jpg`);
    }
    const report = await convertTiles(src, out, ["scan_000"]);
    expect(report.written).toBe(10); // 5 faces × 2 lods
    expect(report.missing).toEqual(["scan_000_down.jpg"]);
    expect(existsSync(join(out, "tiles", "scan_000", "front_256.webp"))).toBe(true);
    expect(existsSync(join(out, "tiles", "scan_000", "front_1024.webp"))).toBe(true);

    const again = await convertTiles(src, out, ["scan_000"]);
    expect(again.skipped).toBe(10); // idempotent

    const hashes = await hashBundle(out);
    expect(Object.keys(hashes)).toContain("tiles/scan_000/front_256.webp");
    expect(hashes["tiles/scan_000/front_256.webp"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL, then implement**

```ts
// tools/twin-forge/src/tiles.ts
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { TWIN_FACES, TWIN_LODS, twinTilePath } from "@omnitwin/types";

export interface TileReport {
  written: number;
  skipped: number;
  missing: string[];
}

/**
 * Existing 1024² cubemap JPGs → WebP at 1024 (q80) and 256 (q75).
 * Idempotent: existing outputs are skipped so re-runs after adding scans
 * only pay for the new work.
 */
export async function convertTiles(
  cubemapsDir: string,
  outDir: string,
  nodeIds: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<TileReport> {
  const report: TileReport = { written: 0, skipped: 0, missing: [] };
  const total = nodeIds.length * TWIN_FACES.length;
  let done = 0;

  for (const nodeId of nodeIds) {
    await mkdir(join(outDir, "tiles", nodeId), { recursive: true });
    for (const face of TWIN_FACES) {
      const srcName = `${nodeId}_${face}.jpg`;
      const src = join(cubemapsDir, srcName);
      done += 1;
      if (!existsSync(src)) {
        report.missing.push(srcName);
        continue;
      }
      for (const lod of TWIN_LODS) {
        const dest = join(outDir, twinTilePath(nodeId, face, lod));
        if (existsSync(dest)) {
          report.skipped += 1;
          continue;
        }
        const pipeline = sharp(src);
        if (lod !== 1024) {
          pipeline.resize(lod, lod, { kernel: "lanczos3" });
        }
        await pipeline.webp({ quality: lod === 1024 ? 80 : 75 }).toFile(dest);
        report.written += 1;
      }
      onProgress?.(done, total);
    }
  }
  return report;
}
```

```ts
// tools/twin-forge/src/hashes.ts
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** SHA-256 every file under outDir (D-014 bundle shape), keyed by posix relpath. */
export async function hashBundle(outDir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name !== "manifest.json") {
        const rel = relative(outDir, full).split("\\").join("/");
        hashes[rel] = createHash("sha256").update(await readFile(full)).digest("hex");
      }
    }
  }
  await walk(outDir);
  return hashes;
}
```

```ts
// tools/twin-forge/src/cli.ts
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildManifest, type RawPoses } from "./build-manifest.js";
import { convertTiles } from "./tiles.js";
import { hashBundle } from "./hashes.js";

const { values } = parseArgs({
  options: {
    cubemaps: { type: "string" },
    poses: { type: "string" },
    out: { type: "string" },
    venue: { type: "string" },
    name: { type: "string" },
    tier: { type: "string", default: "ops-grade-2cm" },
    overrides: { type: "string" },
  },
});

function req(name: string, v: string | undefined): string {
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}

const posesRaw = JSON.parse(await readFile(req("poses", values.poses), "utf8")) as RawPoses;
const overrides = values.overrides === undefined
  ? undefined
  : (JSON.parse(await readFile(values.overrides, "utf8")) as {
      add?: [string, string][];
      remove?: [string, string][];
    });

const manifest = buildManifest(posesRaw, {
  venueSlug: req("venue", values.venue),
  name: req("name", values.name),
  tier: values.tier as "survey-grade-1cm" | "ops-grade-2cm" | "planning-grade-5cm",
  generatedAt: new Date().toISOString(),
  nav: { overrides },
});

const out = req("out", values.out);
const report = await convertTiles(
  req("cubemaps", values.cubemaps),
  out,
  manifest.nodes.map((n) => n.id),
  (done, total) => {
    if (done % 60 === 0 || done === total) {
      process.stdout.write(`tiles ${String(done)}/${String(total)}\n`);
    }
  },
);

manifest.contentHashes = await hashBundle(out);
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
process.stdout.write(
  `forge complete: ${String(manifest.nodes.length)} nodes, ${String(manifest.edges.length)} edges, ` +
  `${String(report.written)} tiles written, ${String(report.skipped)} skipped, ${String(report.missing.length)} missing\n`,
);
```

- [ ] **Step 3: Tests PASS; typecheck PASS.**

- [ ] **Step 4: Commit**

```bash
git add tools/twin-forge/src
git commit -m "feat(twin-forge): webp tile conversion (2 LODs), bundle hashing, CLI"
```

---

### Task 4: Run the forge on real data + gitignore the output

**Files:**
- Modify: `.gitignore` (add `packages/web/public/twin/`)
- Create (generated, NOT committed): `packages/web/public/twin/trades-hall/{manifest.json,tiles/…}`
- Create: `tools/twin-forge/nav-overrides/trades-hall.json` (committed; starts `{"add":[],"remove":[]}`)

- [ ] **Step 1:** Add `packages/web/public/twin/` to `.gitignore`; create the empty overrides file.

- [ ] **Step 2: Run the forge**

```bash
pnpm --filter @omnitwin/twin-forge forge -- --cubemaps "F:\downloads (some very important)\E57\cubemaps" --poses "F:\downloads (some very important)\E57\poses.json" --out "packages/web/public/twin/trades-hall" --venue trades-hall --name "Trades Hall Glasgow" --overrides tools/twin-forge/nav-overrides/trades-hall.json
```

Expected: `forge complete: 149 nodes, ~300–450 edges, 1788 tiles written, 0 skipped, 0 missing`. Record actual numbers in the session log. Sanity: `manifest.json` parses with `TwinManifestSchema`; out dir ≈ 150–350 MB.

- [ ] **Step 3: Commit** (gitignore + overrides only)

```bash
git add .gitignore tools/twin-forge/nav-overrides/trades-hall.json
git commit -m "chore(twin): gitignore generated twin bundles; empty trades-hall nav overrides"
```

---

### Task 5: twin-basis — the one module allowed to know about coordinate frames

**Files:**
- Create: `packages/web/src/twin/twin-basis.ts`
- Test: `packages/web/src/twin/__tests__/twin-basis.test.ts`

**Interfaces:**
- Produces: `e57PointToThree(t: readonly [number,number,number]): [number,number,number]` (E57 Z-up → three Y-up: `[x, z, -y]`); `e57QuatToThree(q: readonly [number,number,number,number]): [number,number,number,number]` returning `[x,y,z,w]` (three.js order) for the same physical rotation re-expressed in the three basis; `scannerForward(q: readonly [number,number,number,number]): [number,number,number]` — world-frame (three) unit vector of the scanner's +X (forward); `FACE_TO_CUBE: Record<TwinFace, { target: "px"|"nx"|"py"|"ny"|"pz"|"nz"; flipX: boolean; flipY: boolean }>` — the single calibration table (initial values below; Task 7's visual calibration step may flip booleans, nothing else).

**The math (from the E57 pipeline CLAUDE.md / `make_brush_dataset_v2.py` conventions):**
Scanner frame: +X forward, +Y left, +Z up. three.js: +X right, +Y up, −Z forward. Basis change (scanner→three): `x₃ = -y_s`, `y₃ = z_s`, `z₃ = -x_s`. For quaternion `q=[w,x,y,z]` (scanner→E57world): build the 3×3 rotation matrix from q, conjugate with the basis matrix (`R₃ = M · R_s · Mᵀ`), convert back to a quaternion — implement numerically, no symbolic shortcut; tests pin the results.

- [ ] **Step 1: Failing test** (scan_000's real pose as fixture):

```ts
// packages/web/src/twin/__tests__/twin-basis.test.ts
import { describe, expect, it } from "vitest";
import { e57PointToThree, e57QuatToThree, scannerForward } from "../twin-basis.js";

// scan_000 from poses.json — the entrance scan; per the E57 pipeline docs its
// forward direction points into the Grand Hall and the scanner was level.
const Q0: readonly [number, number, number, number] =
  [0.7376939654350281, 0.014615842141211033, -0.011572370305657387, -0.6748778820037842];
const T0: readonly [number, number, number] =
  [0.004310831427574158, 0.008259806782007217, 1.4990558624267578];

describe("twin-basis", () => {
  it("converts E57 points to three space (Z-up → Y-up)", () => {
    expect(e57PointToThree([1, 2, 3])).toEqual([1, 3, -2]);
    expect(e57PointToThree(T0)[1]).toBeCloseTo(1.499, 3); // tripod height becomes Y
  });

  it("returns a unit quaternion in three [x,y,z,w] order", () => {
    const q3 = e57QuatToThree(Q0);
    expect(Math.hypot(q3[0], q3[1], q3[2], q3[3])).toBeCloseTo(1, 6);
  });

  it("scan_000 forward is horizontal (level tripod, not floor/ceiling)", () => {
    const f = scannerForward(Q0);
    expect(Math.hypot(f[0], f[1], f[2])).toBeCloseTo(1, 6);
    expect(Math.abs(f[1])).toBeLessThan(0.1); // near-horizontal in three space
  });

  it("identity pose forward maps scanner +X to three -Z", () => {
    const f = scannerForward([1, 0, 0, 0]);
    expect(f[0]).toBeCloseTo(0, 6);
    expect(f[1]).toBeCloseTo(0, 6);
    expect(f[2]).toBeCloseTo(-1, 6);
  });
});
```

- [ ] **Step 2: Implement** — pure module, no three.js import (forge may reuse it later). Quaternion→matrix→conjugate→quaternion, all explicit:

```ts
// packages/web/src/twin/twin-basis.ts
import type { TwinFace } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// twin-basis — the ONLY module allowed to know that the E57 capture frame
// (Z-up, +X scanner-forward, +Y scanner-left) differs from three.js
// (Y-up, -Z camera-forward). Every conversion is pinned by tests; the
// FACE_TO_CUBE table is the single calibration surface for tile orientation.
// Reference math: F:\...\E57\CLAUDE.md §4 and make_brush_dataset_v2.py.
// -----------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Basis matrix M (scanner→three): x₃=-y_s, y₃=z_s, z₃=-x_s (row-major). */
const M: Mat3 = [0, -1, 0, 0, 0, 1, -1, 0, 0];
/** Mᵀ (three→scanner). */
const MT: Mat3 = [0, 0, -1, -1, 0, 0, 0, 1, 0];

function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as unknown as Mat3;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let s = 0;
      for (let k = 0; k < 3; k += 1) {
        s += (a[i * 3 + k] ?? 0) * (b[k * 3 + j] ?? 0);
      }
      r[i * 3 + j] = s;
    }
  }
  return r;
}

/** [w,x,y,z] quaternion → row-major 3×3 rotation matrix. */
function quatToMat(q: readonly [number, number, number, number]): Mat3 {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Row-major 3×3 rotation → [w,x,y,z] quaternion (Shepperd's method). */
function matToQuat(m: Mat3): [number, number, number, number] {
  const t = (m[0] ?? 0) + (m[4] ?? 0) + (m[8] ?? 0);
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = s / 4;
    x = ((m[7] ?? 0) - (m[5] ?? 0)) / s;
    y = ((m[2] ?? 0) - (m[6] ?? 0)) / s;
    z = ((m[3] ?? 0) - (m[1] ?? 0)) / s;
  } else if ((m[0] ?? 0) > (m[4] ?? 0) && (m[0] ?? 0) > (m[8] ?? 0)) {
    const s = Math.sqrt(1 + (m[0] ?? 0) - (m[4] ?? 0) - (m[8] ?? 0)) * 2;
    w = ((m[7] ?? 0) - (m[5] ?? 0)) / s;
    x = s / 4;
    y = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    z = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
  } else if ((m[4] ?? 0) > (m[8] ?? 0)) {
    const s = Math.sqrt(1 + (m[4] ?? 0) - (m[0] ?? 0) - (m[8] ?? 0)) * 2;
    w = ((m[2] ?? 0) - (m[6] ?? 0)) / s;
    x = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    y = s / 4;
    z = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
  } else {
    const s = Math.sqrt(1 + (m[8] ?? 0) - (m[0] ?? 0) - (m[4] ?? 0)) * 2;
    w = ((m[3] ?? 0) - (m[1] ?? 0)) / s;
    x = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
    y = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
    z = s / 4;
  }
  return [w, x, y, z];
}

/** E57 point (Z-up) → three point (Y-up). */
export function e57PointToThree(t: readonly [number, number, number]): Vec3 {
  return [t[0], t[2], -t[1]];
}

/**
 * E57 pose quaternion [w,x,y,z] (scanner→E57world) → three.js quaternion
 * [x,y,z,w] expressing the same physical rotation in the three basis.
 */
export function e57QuatToThree(
  q: readonly [number, number, number, number],
): [number, number, number, number] {
  const r3 = matMul(matMul(M, quatToMat(q)), MT);
  const [w, x, y, z] = matToQuat(r3);
  return [x, y, z, w];
}

/** World-frame (three) unit vector the scanner's +X (forward) points along. */
export function scannerForward(
  q: readonly [number, number, number, number],
): Vec3 {
  const r = quatToMat(q);
  // Scanner forward in E57 world = R · [1,0,0]ᵀ = first column of R.
  const fE57: Vec3 = [r[0] ?? 0, r[3] ?? 0, r[6] ?? 0];
  return e57PointToThree(fE57);
}

/**
 * Which WebGL cube face each scanner face fills, plus per-face flips.
 * CALIBRATION TABLE — Task 7's visual step against scan_000 may correct
 * flips (or remap targets on a gross error); nothing else may.
 */
export const FACE_TO_CUBE: Record<
  TwinFace,
  { target: "px" | "nx" | "py" | "ny" | "pz" | "nz"; flipX: boolean; flipY: boolean }
> = {
  front: { target: "px", flipX: false, flipY: false },
  back: { target: "nx", flipX: false, flipY: false },
  left: { target: "py", flipX: false, flipY: false },
  right: { target: "ny", flipX: false, flipY: false },
  up: { target: "pz", flipX: false, flipY: false },
  down: { target: "nz", flipX: false, flipY: false },
};
```

- [ ] **Step 3: Tests PASS.**

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/twin
git commit -m "feat(web): twin-basis - E57<->three conversions with pinned regression tests"
```

---

### Task 6: Twin route + page shell (public, Rite-voiced states)

**Files:**
- Create: `packages/web/src/pages/TwinPage.tsx`, `packages/web/src/twin/twin-copy.ts`, `packages/web/src/twin/useTwinManifest.ts`, `packages/web/src/twin/twin.css`
- Modify: `packages/web/src/router.tsx` (lazy route `/venues/:venueSlug/twin`, placed ABOVE the `/venues/:venueSlug/rooms/:roomSlug` entry)
- Test: `packages/web/src/__tests__/TwinPage.test.tsx`

**Interfaces:**
- Consumes: `TwinManifestSchema` (Task 1).
- Produces: `TwinPage` named export (router uses `m.TwinPage`); `useTwinManifest(venueSlug: string): { state: "loading" } | { state: "error"; retry: () => void } | { state: "ready"; manifest: TwinManifest }` fetching `${assetBase}/${venueSlug}/manifest.json`, `assetBase = import.meta.env["VITE_TWIN_ASSET_BASE"] ?? "/twin"`, response validated with `TwinManifestSchema.safeParse` (schema failure = error state, never a crash); `twin-copy.ts` exports `TWIN_TITLE = "The Twin — Trades Hall Glasgow"`, `TWIN_LOADING_LINE = "Opening the twin. The hall is on its way."`, `TWIN_ERROR_LINE = "The twin could not be reached. The hall itself is unaffected."`, `TWIN_RETRY_LABEL = "Try again"`, `TWIN_PREPARING_LINE = "The twin is being prepared. Walk the photographs meanwhile."`, `TWIN_DISCLOSURE = "Planning-grade twin — positions and dimensions are planning estimates; final details confirmed by the venue team."`, and `allTwinCopy(): readonly string[]` (claim-guard sweep target).

Tests (mock `@react-three/fiber`'s Canvas exactly as `PlannerScene.test.tsx` does — copy its `vi.mock` block): loading state renders `TWIN_LOADING_LINE`; fetch failure renders error + retry button (clicking refetches — assert fetch called twice); success (fetch mock returns the Task-1 `validManifest` fixture) renders `data-testid="twin-stage"`; `allTwinCopy()` passes `findUnsupportedProposalClaim`; `document.title === TWIN_TITLE`; the page has a named `main` landmark.

- [ ] Steps: failing tests → implement → PASS → typecheck → Commit `feat(web): public twin route with manifest loading and claim-safe copy`

---

### Task 7: PanoStage — cube-sampled sphere, LOD swap, zenith crown

**Files:**
- Create: `packages/web/src/twin/PanoStage.tsx`, `packages/web/src/twin/useCubeTiles.ts`
- Test: `packages/web/src/twin/__tests__/useCubeTiles.test.ts`

**Interfaces:**
- Consumes: `twinTilePath`, `TWIN_FACES` (Task 1); `FACE_TO_CUBE` (Task 5).
- Produces: `PanoStage({ nodeId, assetBase, venueSlug, opacity }): ReactElement` — inverted sphere radius 50, `ShaderMaterial` with uniforms `uCube (samplerCube)`, `uOpacity (float)`, `uCrownColor (vec3, #07100f)`, `uCrownStart (float, 0.82)`; `useCubeTiles(nodeId, base): { texture: CubeTexture | null; lod: 0 | 256 | 1024 }` — loads all six 256 faces (Image → canvas, applying FACE_TO_CUBE flips via scale(-1,1)/(1,-1) draws), builds `THREE.CubeTexture` ordered [px,nx,py,ny,pz,nz] per FACE_TO_CUBE targets, then repeats at 1024 and swaps; disposes on change/unmount.

Fragment shader core (vertex passes object-space direction as `vDir`):

```glsl
uniform samplerCube uCube;
uniform float uOpacity;
uniform vec3 uCrownColor;
uniform float uCrownStart;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // three sampling dir → scanner frame: x_s=-z₃, y_s=-x₃, z_s=y₃
  vec3 s = vec3(-d.z, -d.x, d.y);
  vec4 c = textureCube(uCube, s);
  float crown = smoothstep(uCrownStart, 0.98, max(s.z, 0.0));
  gl_FragColor = vec4(mix(c.rgb, uCrownColor, crown), uOpacity);
}
```

`useCubeTiles` unit test mocks `Image` + canvas 2d context (happy-dom pattern from existing texture tests): asserts six loads per LOD, 256 before 1024, dispose called on node change.

- [ ] **Visual calibration step (mandatory once Task 9's viewer mounts):** dev server up → `/venues/trades-hall/twin?node=scan_000` → screenshot via Task 11's script → compare against `panoramas/scan_000.jpg` (Grand Hall entrance): doorway positions must match and plaque text must NOT be mirrored. Correct ONLY `FACE_TO_CUBE` flips (or targets on a gross 90° error — then update twin-basis/shader comments + tests to pin the corrected mapping). Record the final table in the session log.

- [ ] Commit: `feat(web): twin PanoStage - cube shader, LOD streaming, zenith crown`

---

### Task 8: WalkControls — spring look + fov zoom

**Files:**
- Create: `packages/web/src/twin/WalkControls.tsx`
- Create: `packages/web/src/lib/springs.ts` (MOVE `SpringConfig`, `SpringState`, `stepSpring`, `isSpringSettled` out of `packages/web/src/pages/landing/rite-motion.ts`; rite-motion re-exports from the new module so every existing import keeps working)
- Test: `packages/web/src/twin/__tests__/WalkControls.test.ts`; the whole existing landing test suite must stay green after the move.

**Interfaces:**
- Consumes: springs (`stepSpring`, `isSpringSettled`, configs).
- Produces: `WalkControls({ enabled }: { enabled: boolean })` R3F component — pointer-drag yaw/pitch with spring settle (`{ stiffness: 120, damping: 26 }`), pitch clamped ±85°, wheel fov zoom 30–95 (spring `{ stiffness: 160, damping: 24 }`), touch drag + two-finger pinch for fov; writes `camera.quaternion`/`camera.fov` directly in `useFrame` + `invalidate()` (no per-frame React state). Exports `lookStateFromCamera(camera): { yaw: number; pitch: number }` so Task 9's hops can hand orientation over seamlessly.

Tests: yaw/pitch math pure helpers (extract `dragToYawPitch(dx, dy, sensitivity)` and clamp logic as exported pure functions and test those; the R3F wiring is covered by Task 11's e2e).

- [ ] Commit: `feat(web): twin WalkControls with shared spring core (promoted from rite-motion)`

---

### Task 9: Nav markers + node transitions (the hop)

**Files:**
- Create: `packages/web/src/twin/NavMarkers.tsx`, `packages/web/src/twin/useTwinWalk.ts`, `packages/web/src/twin/TwinViewer.tsx`
- Modify: `packages/web/src/pages/TwinPage.tsx` (mount TwinViewer when manifest ready)
- Test: `packages/web/src/twin/__tests__/useTwinWalk.test.ts`

**Interfaces:**
- Consumes: manifest (Task 6), `PanoStage` (Task 7), `WalkControls` (Task 8), `e57PointToThree` (Task 5), springs.
- Produces: `useTwinWalk(manifest: TwinManifest): { currentId: string; targetId: string | null; progress: number; neighbors: readonly string[]; hopTo: (id: string, opts?: { teleport?: boolean }) => void }` — hop spring `{ stiffness: 70, damping: 16 }` drives progress 0→1; camera position lerps `e57PointToThree(current.t)` → `e57PointToThree(target.t)` during the hop; PanoStage A opacity `1-progress`, B `progress`; on settle B becomes current. `hopTo` accepts only graph neighbors unless `teleport: true` (minimap). URL sync `?node=scan_NNN` via `useSearchParams` (replace during hop, push on settle; back button walks backward). `NavMarkers({ neighbors, nodesById, onHop })` — gold rings (`ringGeometry` r=0.35/0.45, `#d7a64b`, opacity 0.75, hover: emissive pulse via spring + cursor pointer, click → `onHop`) at `[x, y-1.35, z]` (floor level relative to camera height). `TwinViewer({ manifest, assetBase })` composes Canvas (dpr [1,2], continuous frames only while a hop/drag spring is unsettled — `invalidate` pattern from CameraRig) + two PanoStages + WalkControls + NavMarkers + minimap slot + a fixed disclosure line (`TWIN_DISCLOSURE`) + node counter (`data-testid="twin-node-label"`).

`useTwinWalk` tests (renderHook, MemoryRouter wrapper): initial node from `?node=` or falls back `scan_000`; invalid param falls back; `hopTo` rejects non-neighbors without teleport; progress reaches 1 (advance fake timers/rAF) and `currentId` swaps; URL updates.

- [ ] Commit: `feat(web): twin walk - spring hops with crossfade, gold nav rings, url sync`

---

### Task 10: Minimap

**Files:**
- Create: `packages/web/src/twin/TwinMinimap.tsx`
- Test: `packages/web/src/twin/__tests__/TwinMinimap.test.tsx`

**Interfaces:**
- Consumes: `manifest.nodes`, `currentId`, `hopTo` (Task 9).
- Produces: `TwinMinimap({ nodes, currentId, yaw, onSelect })` — fixed bottom-right SVG panel (Rite palette: `#07100f` bg at 0.72 + gold accents): dots at `(t[0], -t[1])` auto-fit with 2 m padding; current node = gold with a 40° view cone rotated by `yaw`; other floors dimmed + floor toggle buttons when >1 floor present; click dot → `onSelect(id)` (teleport); keyboard: the panel is a listbox, arrows move selection among same-floor nodes by proximity, Enter selects. Buttons/dots have aria-labels (`Go to scan 12`).

Tests: renders 4 fixture nodes; click fires `onSelect`; aria labels present; floor toggle hides other-floor dots.

- [ ] Commit: `feat(web): twin minimap - top-down scan graph with teleport`

---

### Task 11: Quality gates — e2e, visual, perf, a11y

**Files:**
- Create: `packages/web/e2e/twin-walk.spec.ts`, `packages/web/scripts/twin-visual-check.mjs`, `packages/web/src/twin/__fixtures__/twin-fixture.ts` (4-node manifest + 1×1 data-URI webp tiles)

**E2E (network fixture-mocked via `page.route` on `/twin/**`):** route renders with named main + `TWIN_TITLE`; hop via nav ring updates `?node=`; minimap teleport works; back button returns; no horizontal overflow at 320/390/768/1280/2048; zero console errors; rings reachable by keyboard (tab + Enter hops); reduced-motion still functional (hops become instant swaps — assert `?node=` still changes).
**Visual script (`twin-visual-check.mjs`, same standalone-Playwright pattern as rite-visual-check):** if `public/twin/trades-hall/manifest.json` missing → print warning, exit 0. Else screenshot: scan_000 view (calibration reference), mid-hop frame, minimap open, mobile 390×844.
**Perf gates:** extend `sspp-performance-budget.test.ts` pattern — twin lazy chunk ≤ 250 KB gz; landing/marketing chunks byte-identical before/after (no three leak: assert the Landing chunk name-list doesn't gain twin modules).

- [ ] Commit: `test(web): twin walk e2e, visual harness, chunk budget gates`

---

### Task 12: Ship pass

- [ ] Full chain from root: `pnpm --filter @omnitwin/types build` → web typecheck → lint → full unit suite → build → twin + landing e2e → both visual scripts.
- [ ] Reviewer: `everything-claude-code:typescript-reviewer` on `packages/web/src/twin/**` + `tools/twin-forge/**`; fix P0/P1s; re-verify.
- [ ] Docs: `tools/twin-forge/README.md` — commands; R2 publish (`rclone copy packages/web/public/twin r2:venviewer-twin --progress` after Blake creates bucket + API token; then set `VITE_TWIN_ASSET_BASE=https://twin.venviewer.com` in Vercel env). Session log + `docs/state/tasks.md` entry + memory update.
- [ ] Deploy posture: until the R2 bucket exists, production `/venues/trades-hall/twin` renders the graceful `TWIN_PREPARING_LINE` state (manifest 404 → error state shows preparing copy when `import.meta.env.PROD` and asset base is the default) — e2e asserts this state so the public route is never broken, merely patient.

---

## Self-review

- **Spec coverage:** tiles/LOD (T3/T7), spring transitions (T9), nav graph + overrides (T2/T4), zenith crown (T7), minimap (T10), public-readiness gates (T11), D-014 bundle shape + hashes (T3), pose-basis regression (T5 + T7 calibration step). Deferred per spec: mesh-depth prewarp (Phase 2, needs GLB), floorplan underlay (Phase 2), R2 upload (blocked on bucket — T12 documents).
- **Placeholder scan:** clean — code steps carry full code; behavioural tasks carry exact interfaces + test lists.
- **Type consistency:** `TwinManifest` / `twinTilePath` / `FACE_TO_CUBE` / `useTwinWalk` / `hopTo` names consistent across tasks; springs module path `src/lib/springs.ts` used by T8/T9.
