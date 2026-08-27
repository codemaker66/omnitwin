import { expect, test, type Page } from "@playwright/test";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The Arrival hero — /'s live "fly-in" intro over the static hero photo
// (packages/web/src/pages/landing/arrival/). This spec proves, in a real
// browser, the three things the hero is actually accountable for:
//
//   1. the static photograph carries the homepage no matter what the hero
//      does (the guarantee that outranks every other line in this file);
//   2. "Open the Hall" really splits the capture into the storeys the
//      building HAS, and they really separate;
//   3. with a live Google key, Google's attribution — BOTH credits — ships.
//
// It is a rebuild. The previous version of this file had five defects an
// adversarial review found, and the corrections are load-bearing enough to
// be worth recording where the next person will read them:
//
// (A) ITS ONE ALWAYS-RUNS TEST ASSERTED SILENCE OVER A PATH THAT DIFFERS BY
//     MACHINE. It loaded "/" with nothing stubbed and asserted zero console
//     errors — but "/" fetches the trades-hall twin manifest
//     (ArrivalHero.tsx:280's useTwinManifest runs BEFORE the no-key gate
//     returns null, so even a keyless visit makes the request) out of
//     packages/web/public/twin, which is gitignored (.gitignore:60). A
//     developer's machine has that bundle and a clean CI checkout does not,
//     so the SAME assertion was being evaluated against two different code
//     paths — manifest parses, HallHandoff mounts, the 7 MB GLB preloads,
//     versus manifest fails validation and none of that happens — with the
//     runner silently choosing which.
//
//     WHAT WAS MEASURED, 2026-08-27, because the review predicted a CI 404
//     and a prediction is not a fact: this repo's dev server answers a
//     MISSING twin path with the SPA fallback — 200, content-type text/html
//     — not a 404 (`curl -H 'Accept: */*' /twin/does-not-exist/manifest.json`
//     → `status=200 type=text/html`), useTwinManifest.ts swallows the parse
//     failure in its own try/catch and logs nothing, and a full load of "/"
//     in that shape produced ZERO console errors. So the old assertion was
//     probably green in CI too, and the "it is red on a clean checkout"
//     diagnosis is NOT reproduced here — recorded as such rather than
//     repeated. The determinism defect above is real regardless, and it is
//     the one being fixed: every navigation below ROUTE-STUBS the bundle, so
//     these assertions mean the same thing on every machine and under every
//     server (dev's SPA fallback, `vite preview`'s 404, and Vercel's rewrite
//     do not answer a missing file alike). Where the point IS production's
//     shape, the stub serves production's shape — see
//     stubTwinBundleAsProduction.
//
// (B) ITS EXPLODE ASSERTION GUARDED NOTHING. `expect(page.locator(
//     "[data-arrival-storey]").first()).toBeVisible()` passes with ONE lump
//     and would pass with a fixture holding no geometry at all — and the
//     fixture it used, TWIN_FIXTURE_MANIFEST_EQUIRECT, puts all four of its
//     nodes on floor 0, so storeyBoundaries() returned [] and the "explode"
//     it certified was a single unsplit bucket. The real capture has exactly
//     TWO storeys (public/twin/trades-hall/manifest.json, read 2026-08-27:
//     149 nodes, 84 on floor 0 mean z +1.423 m, 65 on floor −1 mean z
//     −1.704 m — boundary −0.1405 m, matching ExplodedHall.tsx's own header).
//     TWO_STOREY_MANIFEST below reproduces those exact means, and
//     twoStoreyGlbBytes() supplies real chunk geometry sitting on them, so
//     the assertion can pin what it claims: two storeys, the right two, with
//     the right names, genuinely apart on screen. See THE STOREY FIXTURE.
//
// (C) ITS ATTRIBUTION ASSERTION COULD NOT FAIL. `[id^="class_"]` is the
//     overlay CONTAINER, which 3d-tiles-renderer renders unconditionally
//     (TilesAttributionOverlay.jsx:123-140) whether or not it has a single
//     attribution inside it — so the assertion was true even in the exact
//     state commit e51b9475 fixed, where `logoUrl` was never passed and
//     GoogleCloudAuthPlugin.getAttributions() silently skipped the logo
//     credit (`if ( this.logoUrl )`, GoogleCloudAuthPlugin.js:118-125). The
//     keyed case below asserts the CONTENTS: a non-empty text/copyright
//     credit AND an <img> carrying the brand mark's exact URL.
//
// (D) ITS KEYLESS CASES FAILED ON A KEYED MACHINE. "No .arrival-hero exists"
//     is only true where no live hero mounts; on a machine with a key the
//     hero mounts and those two tests failed, so the file could never be
//     green as a whole. Split below: the photograph assertion is
//     unconditional (it is true everywhere, and it is the real invariant),
//     and only the "nothing is layered over it" half is gated.
//
// (E) ITS SKIP CONDITION READ THE WRONG SOURCE — the worst of the five. It
//     read process.env["VITE_GOOGLE_MAPS_TILES_KEY"], but the documented
//     home for that key is packages/web/.env.local (arrival-config.ts:2-3),
//     which Vite loads into the DEV SERVER's import.meta.env and never into
//     the Playwright runner's process.env. A developer who installed the key
//     the documented way got two silently-skipped tests and a green suite
//     that had tested nothing. See KEY GATING below.
//
// THE VERIFIED DOM CONTRACT (read from the shipped source, not the plan):
//   - `.arrival-hero` wrapper carries `data-arrival-phase` — ArrivalHero.tsx
//     :411-413 (`<div className="arrival-hero" data-arrival-phase={phase}>`),
//     values from ArrivalPhase (arrival-store.ts:3): loading | flight |
//     arrived | exploded | fallback.
//   - No API key (or a poster-tier device) → useArrivalGate blocks and
//     ArrivalHero returns null before ever mounting a canvas
//     (ArrivalHero.tsx:378-391) — and FreshPage.tsx wraps it in
//     `<Suspense fallback={null}>` layered over the `<picture>`/
//     `<img className="fr-hero-photo">`, so the photo alone carries the hero.
//   - The Skip button, text exactly ARRIVAL_SKIP_LABEL = "Skip the flight"
//     (ArrivalHero.tsx:108), renders only while phase === "flight"
//     (ArrivalHero.tsx:445-455).
//   - "Open the Hall" (ARRIVAL_OPEN_HALL_LABEL, ArrivalHero.tsx:114) renders
//     only in "arrived" AND only when `dollhouseReady` (:456) — manifest
//     ready with a mesh in it — and calls explode() (arrival-store.ts:66-68).
//   - Storey labels are `div.arrival-storey-label[data-arrival-storey=
//     {entry.bucket}]` (ArrivalHero.tsx:210-218), each holding the storey
//     name and a "Plan this room" button whose aria-label is
//     `Plan ${entry.label}` (:246-255), plus one "Close" button (:260-271)
//     that calls reassemble() back to "arrived".
//   - reduced motion short-circuits the phase machine: useArrivalGate
//     (use-arrival-gate.ts:46-50) flips the store's `reducedMotion` flag
//     once, on mount, from a live OS/emulated read of prefersReducedMotion();
//     arrival-store.ts's tilesReady() (:53-59) then goes loading -> arrived
//     DIRECTLY in one synchronous `set()`, never touching "flight". The
//     keyed case below still proves it by watching phase HISTORY, not the
//     final value — a browser round trip against a real network is exactly
//     the kind of thing that can surprise a "the code reads atomic"
//     argument, and the E2E suite is not for taking that on faith.
//
// THE GPU / SERIAL RECIPE (matched from the twin specs in this same
// directory — twin-visual.spec.ts:78-83, plan-room-runtime-default.spec.ts
// :27-30, public-config-flow.spec.ts:27-30 all state the same policy): a
// live WebGL context streaming real network imagery, run concurrently with
// this repo's OTHER WebGL-heavy specs under Playwright's fullyParallel
// default, measures the test runner's GPU contention rather than this
// feature — so this spec keeps `mode: "serial"` and lives in its OWN file,
// never sharing a file with twin-visual.spec.ts or plan-room-resolve.spec.ts.
// Nothing here calls `page.screenshot()`/canvas `.screenshot()` (no
// ReadPixels), so the "no evaluate after a heavy readback" half of that
// recipe does not apply to this file — noted for the next person who copies
// this file as a template and adds one.
//
// KEY GATING — WHERE THE TRUTH ACTUALLY LIVES (defect E above).
// googleTilesApiKey() reads import.meta.env["VITE_GOOGLE_MAPS_TILES_KEY"]
// (arrival-config.ts:6-14). Vite composes that value from FOUR sources, in
// its own precedence order: process.env (VITE_-prefixed only), .env,
// .env.development, .env.local, .env.development.local — resolved against
// the Vite ROOT, which for playwright.config.ts's `pnpm dev` child process is
// packages/web. Reading process.env alone therefore sees only ONE of those
// sources, and not the documented one. Rather than re-implement that
// precedence (the exact class of mistake this is fixing), this file calls
// Vite's own `loadEnv` — the same function Vite uses — against the same root.
// That is the truth for the server playwright.config.ts starts.
//
// Two things it deliberately cannot know, each handled where it bites:
//   - A REMOTE server (E2E_START_SERVER=false + E2E_BASE_URL). Nothing local
//     can answer for someone else's build; noted here, gate accepted as
//     best-effort, and the keyed test's own first assertion (the hero
//     mounts) fails loudly rather than passing vacuously if it is wrong.
//   - A POSTER-TIER GPU. useArrivalGate blocks BEFORE the key is even
//     consulted when device tier is "poster" (use-arrival-gate.ts:52-54),
//     which is exactly what a headless CI Chromium on SwiftShader is
//     (device-tier.ts:29-31). A keyed run there can never mount a hero, so
//     the keyed cases below detect that from the live WebGL renderer string
//     and skip with THAT reason named, instead of failing as if the key were
//     the problem. Both gates print their reason — a skip in this file
//     always says which of the two it was.
//
// THE PHASE-DEPENDENT CASES DO NOT NEED A KEY. ArrivalHero self-gates to
// null without one, but arrival-dev-harness.ts's DEV-only `?arrivalPhase=`
// seam (double-guarded by import.meta.env.DEV, stripped from production
// builds) drives the store directly and deliberately does NOT mount
// GoogleTilesStage — no key, no billable tile request, and the storey case
// below runs everywhere, always. This is the same seam
// arrival-hero-controls.spec.ts uses, and it carries that file's caveat:
// under `E2E_WEB_SERVER=preview` the seam is compiled out, so the harness
// cases are dev-server cases (CI runs the dev server — playwright.config.ts
// :21-26 — and nothing in this repo sets preview mode).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Key gating.
// ---------------------------------------------------------------------------

/** packages/web — the Vite root playwright.config.ts's `pnpm dev` runs in. */
const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The key as the DEV SERVER will see it: Vite's own resolution over
 * process.env + every .env file it would load, not just one of them. See
 * KEY GATING in the file header for why reading process.env alone was the
 * defect this replaces.
 */
const CONFIGURED_TILES_KEY = loadEnv("development", WEB_ROOT, "VITE_")[
  "VITE_GOOGLE_MAPS_TILES_KEY"
];
const HAS_TILES_KEY =
  typeof CONFIGURED_TILES_KEY === "string" && CONFIGURED_TILES_KEY.trim().length > 0;

const NO_KEY_REASON =
  "no VITE_GOOGLE_MAPS_TILES_KEY configured for the dev server — checked process.env AND " +
  "packages/web/.env[.development][.local] through Vite's own loadEnv (see arrival-config.ts)";
const HAS_KEY_REASON =
  "a VITE_GOOGLE_MAPS_TILES_KEY IS configured, so this build mounts a live Arrival hero — " +
  "this case describes the keyless homepage and cannot be true here";

/**
 * device-tier.ts:29-31's own poster patterns, applied to the live renderer
 * string. useArrivalGate blocks poster tier BEFORE it looks at the key
 * (use-arrival-gate.ts:52-54), so on a software rasteriser (headless CI
 * Chromium is SwiftShader) no key can produce a hero — and a keyed case that
 * failed there would be blaming the wrong thing.
 */
const POSTER_RENDERER = /SwiftShader|llvmpipe|Software Rasterizer/i;

async function rendererString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) {
      return "NO-WEBGL";
    }
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw: unknown =
      ext === null
        ? gl.getParameter(gl.RENDERER)
        : gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof raw === "string" ? raw : "UNKNOWN";
  });
}

// ---------------------------------------------------------------------------
// THE STOREY FIXTURE — a real two-storey building, small enough to ship in a
// test (defect B above).
//
// The shipped bundle is gitignored, so the numbers below are transcribed from
// it rather than loaded: packages/web/public/twin/trades-hall/manifest.json,
// read 2026-08-27 — 149 nodes over exactly two floor values, 84 on floor 0
// (mean pose.t[2] = +1.423 m) and 65 on floor −1 (mean −1.704 m). The four
// nodes here reproduce BOTH means exactly ((−2.13 + −1.278)/2 = −1.704;
// (1.72 + 1.126)/2 = 1.423), so storeyBoundaries() lands on the real
// building's real boundary, −0.1405 m — the same figure ExplodedHall.tsx's
// header records. Not a rounder, tidier pair of numbers: the margin between
// each floor mean and that boundary is what Task 8's calibration trip-wire is
// about, and a fixture with a comfortable synthetic gap would stop measuring
// it.
//
// Floor identity is the walkthrough's own recorded finding (TwinViewer.tsx
// :116, echoed in ExplodedHall.tsx's header): manifest floor 0 is the FIRST
// floor — Grand Hall and Saloon — and floor −1 is the ground floor —
// Reception Room and Robert Adam Room. Bucket 0 is the lowest storey
// (storeyFloors sorts ascending), so bucket 0 is floor −1.
// ---------------------------------------------------------------------------

/** pose.t[2] of the two floor means in the real bundle, metres, E57 frame. */
const FLOOR_MINUS_ONE_MEAN_Z = -1.704;
const FLOOR_ZERO_MEAN_Z = 1.423;

const TWO_STOREY_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  schema: "twin/0",
  venueSlug: "trades-hall",
  name: "Trades Hall Glasgow",
  capture: { kind: "matterport-e57", scanCount: 4 },
  tier: "ops-grade-2cm",
  upAxis: "z",
  units: "m",
  imagery: "equirect",
  faces: ["front", "back", "left", "right", "up", "down"],
  lods: [512, 4096, 8192],
  generatedAt: "2026-08-27T00:00:00.000Z",
  nodes: [
    // Floor −1 (ground): the two extremes of the real floor's spread, whose
    // mean is the real floor mean.
    { id: "scan_000", index: 0, pose: { q: [1, 0, 0, 0], t: [0, 0, -2.13] }, floor: -1, roomSlug: "reception-room" },
    { id: "scan_001", index: 1, pose: { q: [1, 0, 0, 0], t: [4, 0, -1.278] }, floor: -1, roomSlug: "robert-adam-room" },
    // Floor 0 (first floor).
    { id: "scan_002", index: 2, pose: { q: [1, 0, 0, 0], t: [0, 0, 1.72] }, floor: 0, roomSlug: "grand-hall" },
    { id: "scan_003", index: 3, pose: { q: [1, 0, 0, 0], t: [4, 0, 1.126] }, floor: 0, roomSlug: "saloon" },
  ],
  edges: [
    { a: "scan_000", b: "scan_001", distanceM: 4 },
    { a: "scan_002", b: "scan_003", distanceM: 4 },
    { a: "scan_001", b: "scan_002", distanceM: 3.1 },
  ],
  mesh: { path: "mesh/dollhouse.glb", bytes: 7342964, sourceName: "trades-hall-dollhouse-reviewed.glb" },
});

/**
 * ExplodedHall.tsx:141-144's ARRIVAL_STOREY_LABELS, restated as literals
 * because this file cannot import that module (it pulls in three, R3F and
 * react-router; the spec runs in Node). Composition from ROOM_DISPLAY_NAMES
 * is pinned by ExplodedHall.test.tsx — what is pinned HERE is the rendered
 * result, which is what a visitor reads. Index = storey bucket, lowest first.
 */
const EXPECTED_STOREY_LABELS = [
  "Reception Room & Robert Adam Room", // bucket 0 — floor −1, the ground floor
  "Grand Hall & Saloon", // bucket 1 — floor 0, the first floor
] as const;

/**
 * The floor, in CSS pixels, under the settled vertical distance between the
 * two storey labels' projected anchors — at the 1440×900 viewport the storey
 * case pins, with the rail's held arrival pose (camera-rail.ts's final
 * keyframe, position [-58, 26, 40] looking at [0, 13, 0], fov 45).
 *
 * MEASURED, not chosen. Both numbers below are from real runs of the case
 * below on 2026-08-27, differing only in the mesh served:
 *
 *   with TWO_STOREY_MESH_BYTES   →  75.85 px   (the real behaviour)
 *   with EMPTY_MESH_BYTES        →  46.69 px   (the counterfactual)
 *
 * The counterfactual is what "the explode ran but bucketed no geometry"
 * looks like: with no chunk meshes every StoreyBucket's anchor falls back to
 * the origin (ExplodedHall.tsx's `count > 0 ? … : new Vector3()`), so the
 * labels are separated by the explode offset ALONE — bucket 1's
 * explodeOffsetY of 5 m, and nothing of the building. With real chunks the
 * anchors are real centroids at the two floor means, adding their own 3.13 m
 * (1.423 − −1.704) on top: 8.13 m, and 29 px more on screen.
 *
 * 60 px sits between the two with ~22% clearance either side, so this
 * assertion fails — rather than passing on the explode animation alone — if
 * the geometry stops being bucketed, if the two buckets collapse into one, or
 * if either anchor stops tracking its storey. That is the whole point: a
 * threshold below 46.69 would have been satisfied by a hall containing
 * nothing, which is the defect this case replaces.
 */
const SEPARATED_GAP_MIN_PX = 60;

const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

const SKIP_LABEL = "Skip the flight";
const OPEN_HALL_LABEL = "Open the Hall";

/**
 * GOOGLE_MAPS_ATTRIBUTION_LOGO_URL (arrival-config.ts) — restated as a
 * literal for the same reason as the storey labels: arrival-config.ts is a
 * Vite module (it dereferences import.meta.env) and cannot be imported into a
 * Node test process. This is the value commit e51b9475 started passing as
 * GoogleCloudAuthPlugin's `logoUrl`; without it the plugin emits no logo
 * credit at all.
 */
const GOOGLE_LOGO_URL = "/images/brand/google-maps-attribution-logo.png";

// ---------------------------------------------------------------------------
// GLB fixtures.
// ---------------------------------------------------------------------------

/** Assembles a GLB 2.0 container from a glTF JSON chunk and an optional BIN. */
function glbBytes(gltf: unknown, bin: Buffer | null): Buffer {
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);

  const chunks: Buffer[] = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  chunks.push(jsonHeader, jsonChunk);

  if (bin !== null) {
    const binPad = (4 - (bin.byteLength % 4)) % 4;
    const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.byteLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"
    chunks.push(binHeader, binChunk);
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + body.byteLength, 8);
  return Buffer.concat([header, body]);
}

/**
 * A valid, EMPTY GLB 2.0 scene — the fixture the other arrival/twin specs in
 * this directory use when the dollhouse only has to exist, not to contain
 * anything. Kept here because the "the hall opens at all" paths still want
 * the cheapest possible mesh.
 */
const EMPTY_MESH_BYTES = glbBytes(
  { asset: { version: "2.0" }, scene: 0, scenes: [{}] },
  null,
);

/**
 * A GLB holding ONE chunk per storey, sitting at each floor's real mean
 * height, so bucketAndReparentChunks has genuine geometry to bucket and each
 * StoreyBucket gets a genuine anchor centroid rather than the origin.
 *
 * Both triangles are NON-INDEXED on purpose. HallHandoff runs
 * pruneDollhouseShell then applyDollhouseCaps over whatever it loads, and
 * BOTH skip a geometry whose index is null (dollhouse-shell.ts:1098-1100,
 * dollhouse-peel.ts:256-261) — so these chunks pass through the repair stack
 * untouched and the only thing acting on them is the bucketing under test.
 * (That also honours the standing rule that the peel system's material.side
 * / facing split is never a thing a test may perturb.)
 *
 * Coordinates are the E57 capture frame, exactly like the manifest poses
 * they must bucket against: ExplodedHall's storeySamplesFromNodes and
 * chunkWorldCentroid put node poses and chunk centroids through the SAME
 * placement matrix (its own TASK 8 TRIP-WIRE comment is about keeping them
 * that way), so a chunk written at z = a floor's mean pose height lands, by
 * construction, on that floor.
 */
function twoStoreyGlbBytes(): Buffer {
  // One flat triangle per storey, 6 m across, centred on (0, 0, meanZ): the
  // bounding-box centre chunkWorldCentroid reads is therefore exactly meanZ.
  const triangleAt = (z: number): readonly number[] => [-3, -3, z, 3, -3, z, 0, 3, z];
  const lower = triangleAt(FLOOR_MINUS_ONE_MEAN_Z);
  const upper = triangleAt(FLOOR_ZERO_MEAN_Z);

  const bin = Buffer.alloc((lower.length + upper.length) * 4);
  [...lower, ...upper].forEach((value, i) => {
    bin.writeFloatLE(value, i * 4);
  });
  const stride = lower.length * 4;

  const accessor = (offsetIndex: number, z: number): unknown => ({
    bufferView: offsetIndex,
    componentType: 5126, // FLOAT
    count: 3,
    type: "VEC3",
    min: [-3, -3, z],
    max: [3, 3, z],
  });

  return glbBytes(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { mesh: 0, name: "storey-lower" },
        { mesh: 1, name: "storey-upper" },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 } }] },
        { primitives: [{ attributes: { POSITION: 1 } }] },
      ],
      accessors: [
        accessor(0, FLOOR_MINUS_ONE_MEAN_Z),
        accessor(1, FLOOR_ZERO_MEAN_Z),
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: stride, target: 34962 },
        { buffer: 0, byteOffset: stride, byteLength: stride, target: 34962 },
      ],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  );
}

const TWO_STOREY_MESH_BYTES = twoStoreyGlbBytes();

// ---------------------------------------------------------------------------
// Route stubs. Every navigation in this file goes through one of these, so no
// assertion here depends on packages/web/public/twin existing (defect A).
// ---------------------------------------------------------------------------

async function stubTwinBundle(
  page: Page,
  manifest: TwinManifest,
  mesh: Buffer,
): Promise<void> {
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manifest),
    }),
  );
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: mesh }),
  );
}

/**
 * PRODUCTION's actual shape for the twin bundle, served deterministically.
 * packages/web/public/twin is gitignored, so on CI and on Vercel the manifest
 * request hits the SPA rewrite and comes back as index.html with a 200 — the
 * fetch "succeeds" and only fails when parsed. That is the documented reason
 * FRESH_TOUR_ENABLED is false today, and it is the shape the homepage
 * guarantees below must hold under. Serving it from a route stub is what
 * makes those guarantees identical on a developer's machine (where the real
 * bundle IS present) and on a clean checkout (where it is not).
 */
async function stubTwinBundleAsProduction(page: Page): Promise<void> {
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Venviewer</title></head><body></body></html>",
    }),
  );
}

const GOOGLE_TILES_ROOT_ROUTE = "https://tile.googleapis.com/v1/3dtiles/root.json*";

/**
 * Takes Google entirely out of a case that is not about Google.
 *
 * The storey case below drives the phase machine through the DEV harness, so
 * it needs no key — but on a machine that HAS one, ArrivalHero still mounts
 * GoogleTilesStage (ArrivalHero.tsx:441 gates only on apiToken !== null, not
 * on the harness), and a tiles `load-error` calls fail("tiles"), which
 * OVERRIDES the pinned phase and drops the hero into "fallback"
 * (arrival-store.ts:72-76). Measured, not theorised: with a key installed
 * that Google rejects, that case went red on `data-arrival-phase="fallback"`
 * before it could click anything.
 *
 * So the root tileset is answered locally with a minimal, valid, EMPTY 3D
 * Tiles 1.1 tileset. Nothing errors, so fail("tiles") never fires; the root
 * carries no content and no children, so not one further request is made;
 * and GoogleCloudAuth's getSessionToken (GoogleCloudAuth.js:171-197) simply
 * finds no session token and carries on, which is not an error path. The
 * result is a case that costs nothing, needs no network, and measures the
 * bucketing rather than a third party's availability — on every machine, in
 * the same way. On a keyless machine the route is never even requested.
 */
async function stubGoogleTilesRootAsEmpty(page: Page): Promise<void> {
  await page.route(GOOGLE_TILES_ROOT_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asset: { version: "1.1" },
        geometricError: 0,
        root: {
          // Centre + three half-axis vectors, the 3D Tiles `box` form. Real
          // extents rather than zeros, so nothing downstream divides by one.
          boundingVolume: { box: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100] },
          geometricError: 0,
          refine: "ADD",
        },
      }),
    }),
  );
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  return errors;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

declare global {
  interface Window {
    /** Every DISTINCT value data-arrival-phase has taken on `.arrival-hero`,
     *  in order — recorded by an init script installed before navigation, so
     *  the very first value (set the instant React first mounts the div) is
     *  never missed by a listener that starts too late. */
    __arrivalPhasesSeen?: string[];
  }
}

/**
 * Installs a MutationObserver, before navigation, that records the full
 * ordered history of `.arrival-hero`'s data-arrival-phase attribute. A
 * final-state check alone ("phase is now arrived") cannot prove the
 * reduced-motion claim ("never passed through flight") — only a genuine
 * history can.
 */
async function watchArrivalPhases(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    window.__arrivalPhasesSeen = seen;

    const record = (el: Element): void => {
      const phase = el.getAttribute("data-arrival-phase");
      if (phase === null) {
        return;
      }
      if (seen[seen.length - 1] !== phase) {
        seen.push(phase);
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          record(mutation.target);
        }
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return;
          }
          const hero = node.matches(".arrival-hero") ? node : node.querySelector(".arrival-hero");
          if (hero !== null) {
            record(hero);
          }
        });
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-arrival-phase"],
    });
  });
}

async function arrivalPhasesSeen(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__arrivalPhasesSeen ?? []);
}

/** The hero photo, proved to have actually decoded — not merely laid out. */
async function expectHeroPhotoCarriesThePage(page: Page): Promise<void> {
  const photo = page.locator("img.fr-hero-photo");
  await expect(photo).toBeVisible();
  // `toBeVisible` is satisfied by a broken image with alt text and a non-zero
  // box. naturalWidth is the only thing that says a photograph is on screen,
  // which is the entire content of the guarantee.
  await expect
    .poll(async () => photo.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// 1. The guarantee that outranks everything else — runs everywhere, always,
//    keyed or keyless, with the twin bundle in its production (broken) shape.
// ---------------------------------------------------------------------------

test("the static hero photo carries the homepage, and nothing throws", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await stubTwinBundleAsProduction(page);

  await page.goto("/");

  await expectHeroPhotoCarriesThePage(page);

  // ArrivalHero is lazy-loaded, and on a keyed build it goes on to mount a
  // canvas and stream real tiles — give the chunk, the gate and any early
  // failure path time to have happened before judging silence.
  await page.waitForTimeout(2_000);

  // Uncaught exceptions only. NOT console errors: on a keyed build a
  // legitimately failing tile session logs a deliberate diagnostic
  // (GoogleTilesStage.tsx's describeTilesFailure) and the homepage is still
  // fine — that is the designed behaviour, not a defect. What must never
  // happen, in any environment, is an exception escaping into the page: it is
  // the only class of hero failure that can take the document with it. The
  // keyless case below adds the stricter silence assertion, where it is true.
  expect(pageErrors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 2. Keyless — the homepage as CI, and every dev machine today, actually
//    serves it. Gated on the configured key because the claim ("no live
//    Arrival mount exists") is only true of a keyless build (defect D).
// ---------------------------------------------------------------------------

test("keyless: no live Arrival mounts at all, and the hero is silent", async ({ page }) => {
  test.skip(HAS_TILES_KEY, HAS_KEY_REASON);

  const consoleErrors = collectConsoleErrors(page);
  await stubTwinBundleAsProduction(page);

  await page.goto("/");

  await expectHeroPhotoCarriesThePage(page);

  // Closing a "the lazy chunk hasn't downloaded yet" race, not waiting out a
  // delay the product imposes: once the chunk resolves, ArrivalHero.tsx
  // :378-391 returns null synchronously.
  await page.waitForTimeout(2_000);
  await expect(page.locator(".arrival-hero")).toHaveCount(0);

  // With no key there is nothing for the hero to legitimately complain
  // about: the gate returns before any canvas, any tile request or any
  // diagnostic. Anything in this list is a real regression. The twin bundle
  // is stubbed above, so a checkout without packages/web/public/twin cannot
  // contribute noise here (defect A).
  expect(consoleErrors).toEqual([]);
});

test("keyless + reduced motion: still just the photograph", async ({ page }) => {
  test.skip(HAS_TILES_KEY, HAS_KEY_REASON);

  await stubTwinBundleAsProduction(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expectHeroPhotoCarriesThePage(page);
  await page.waitForTimeout(2_000);
  await expect(page.locator(".arrival-hero")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 3. The explode — the real building's real two storeys (defect B). Runs
//    everywhere, keyed or not, through the DEV `?arrivalPhase=` seam.
// ---------------------------------------------------------------------------

test("Open the Hall splits the capture into its two real storeys, and they separate", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // A fixed viewport so the projected label geometry below is a measurement
  // and not a function of whatever size the runner defaulted to.
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubTwinBundle(page, TWO_STOREY_MANIFEST, TWO_STOREY_MESH_BYTES);
  // Keyless machines never request this; keyed ones must not be able to drop
  // this case into "fallback" over a third party — see the helper's comment.
  await stubGoogleTilesRootAsEmpty(page);

  await page.goto("/?arrivalPhase=arrived");
  const hero = page.locator(".arrival-hero");
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived", { timeout: 20_000 });

  // "Open the Hall" only exists when HallHandoff will really render something
  // (ArrivalHero.tsx:456's dollhouseReady) — so reaching it at all already
  // says the stubbed bundle was accepted, not merely requested.
  await page.getByRole("button", { name: OPEN_HALL_LABEL, exact: true }).click();
  await expect(hero).toHaveAttribute("data-arrival-phase", "exploded");

  const storeys = page.locator("[data-arrival-storey]");
  // EXACTLY two. The previous version asserted `.first()` was visible, which
  // is equally true of one unsplit lump — and one lump is precisely what its
  // all-nodes-on-floor-0 fixture produced.
  await expect(storeys).toHaveCount(2, { timeout: 15_000 });

  // The storeys we expect, in the order the bucketing defines (bucket 0 =
  // lowest = the ground floor), each carrying its real room names and its
  // live "Plan this room" control.
  await expect(storeys.nth(0)).toHaveAttribute("data-arrival-storey", "0");
  await expect(storeys.nth(1)).toHaveAttribute("data-arrival-storey", "1");
  for (const [bucket, label] of EXPECTED_STOREY_LABELS.entries()) {
    const storey = page.locator(`[data-arrival-storey="${String(bucket)}"]`);
    await expect(storey).toContainText(label);
    await expect(storey.getByRole("button", { name: `Plan ${label}` })).toBeVisible();
  }

  // …and they are genuinely APART, with the upper storey above the lower one.
  // The overlay is repositioned every unsettled frame, so poll to the spring's
  // rest rather than sampling one arbitrary frame of the animation.
  const gapPx = async (): Promise<number> => {
    const lower = await page.locator('[data-arrival-storey="0"]').boundingBox();
    const upper = await page.locator('[data-arrival-storey="1"]').boundingBox();
    if (lower === null || upper === null) {
      return 0;
    }
    // Centres, not tops: the two labels carry different text and could wrap to
    // different heights, and each is positioned by translate(-50%, -50%) on its
    // own projected anchor — so only the centre is the projected point itself.
    // Positive when the upper storey really is higher up the screen.
    return lower.y + lower.height / 2 - (upper.y + upper.height / 2);
  };
  await expect.poll(gapPx, { timeout: 15_000 }).toBeGreaterThan(SEPARATED_GAP_MIN_PX);

  // Close returns the hall, and takes the labels with it.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived");
  await expect(storeys).toHaveCount(0, { timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// 4. Keyed — the only two things that genuinely need Google's live service.
// ---------------------------------------------------------------------------

test("keyed: the flight starts on real tiles, and BOTH Google credits ship with it", async ({
  page,
}) => {
  test.skip(!HAS_TILES_KEY, NO_KEY_REASON);
  test.setTimeout(90_000);

  await stubTwinBundle(page, TWO_STOREY_MANIFEST, EMPTY_MESH_BYTES);
  await page.goto("/");
  const renderer = await rendererString(page);
  test.skip(
    POSTER_RENDERER.test(renderer),
    `poster-tier GPU (${renderer}) — useArrivalGate blocks the hero before the key is ` +
      "consulted (use-arrival-gate.ts:52-54), so no keyed case can run on this machine",
  );

  const hero = page.locator(".arrival-hero");
  // First-idle on Google's real tileset is a genuine network round trip —
  // generous but bounded, matching this repo's posture for live-network waits
  // (trades-hall-visual.spec.ts:219 allows 120_000ms for a real R2 asset).
  await expect(hero).toHaveAttribute("data-arrival-phase", "flight", { timeout: 45_000 });

  // THE GOOGLE ToS CONTRACT (defect C). The overlay container exists whether
  // or not it holds anything, so the container is not the assertion — its
  // CONTENTS are. 3d-tiles-renderer renders one <div> per attribution:
  // type "string" becomes a text div, type "image" becomes <div><img src=…>
  // (TilesAttributionOverlay.jsx:89-112). GoogleCloudAuthPlugin pushes the
  // image credit ONLY when logoUrl is set (GoogleCloudAuthPlugin.js:118-125)
  // — that omission was the shipped bug e51b9475 fixed, and it is invisible
  // to any assertion that stops at the container.
  const overlay = hero.locator('[id^="class_"]').first();
  await expect(overlay).toBeAttached();

  const logo = overlay.locator(`img[src="${GOOGLE_LOGO_URL}"]`);
  await expect(logo).toBeAttached({ timeout: 30_000 });
  // The mark has to be a mark, not a broken image: a 404 renders as nothing
  // at all and the ToS requirement is unmet just as completely as when the
  // credit was never emitted. arrival-config.ts's own NEEDS_CONTEXT note
  // (the asset is not committed yet) is exactly what this catches.
  expect(await logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // …and the text/copyright credit beside it, which is the OTHER of the two
  // attributions Google's policies require.
  const credit = overlay.locator("div", { hasText: /\S/ }).first();
  await expect(credit).toBeAttached();
  expect((await overlay.innerText()).trim().length).toBeGreaterThan(0);

  // Skip is WCAG 2.2.2's pause control for an 11-second automatic animation;
  // it exists only during flight (ArrivalHero.tsx:445-455).
  await page.getByRole("button", { name: SKIP_LABEL, exact: true }).click();
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived");

  // The invariant that outranks the hero: even with the live canvas up, the
  // photograph is still underneath, still carrying the page.
  await expectHeroPhotoCarriesThePage(page);
});

test("keyed + reduced motion: arrives without ever passing through flight", async ({ page }) => {
  test.skip(!HAS_TILES_KEY, NO_KEY_REASON);
  test.setTimeout(90_000);

  await stubTwinBundle(page, TWO_STOREY_MANIFEST, EMPTY_MESH_BYTES);
  await watchArrivalPhases(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/");
  const renderer = await rendererString(page);
  test.skip(
    POSTER_RENDERER.test(renderer),
    `poster-tier GPU (${renderer}) — useArrivalGate blocks the hero before the key is ` +
      "consulted (use-arrival-gate.ts:52-54), so no keyed case can run on this machine",
  );

  const hero = page.locator(".arrival-hero");
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived", { timeout: 45_000 });

  const phases = await arrivalPhasesSeen(page);
  expect(phases).toContain("arrived");
  expect(phases).not.toContain("flight");
});
