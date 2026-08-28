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
//   3. Google's attribution — BOTH credits — ships, on every machine and
//      without a key, because a ToS guard that only runs where somebody has
//      a paid key and a discrete GPU is not a guard.
//
// It is a rebuild. The previous version of this file had five defects an
// adversarial review found, and the corrections are load-bearing enough to
// be worth recording where the next person will read them:
//
// (A) ITS ONE ALWAYS-RUNS TEST ASSERTED SILENCE OVER A PATH THAT DIFFERS BY
//     MACHINE. It loaded "/" with nothing stubbed and asserted zero console
//     errors — but "/" fetches the trades-hall twin manifest
//     (ArrivalHero's own useTwinManifest call runs BEFORE the no-key gate
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
//     credit (`if ( this.logoUrl )`, GoogleCloudAuthPlugin.js:118-125). Its
//     replacement asserts the CONTENTS — a non-empty text/copyright credit
//     AND an <img> carrying the brand mark's exact URL — and, since the
//     rewrite that first made that assertion real still could not RUN
//     (double-gated on a key and a non-poster GPU, and headless Chromium is
//     SwiftShader on every machine), it now runs unconditionally through the
//     DEV tiles seam. See THE ATTRIBUTION FIXTURE.
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
// HOW THIS FILE CITES SOURCE — a convention, arrived at the hard way.
// Citations into packages/web/src name the SYMBOL, never the line. The first
// version of this file cited ArrivalHero.tsx by line in seven places; one
// robustness wave later every single one of them pointed at the wrong thing
// (the file had moved by 1-36 lines), and a comment that confidently names a
// line it is wrong about is worse than one that names none — it sends the
// reader to the wrong code and looks authoritative doing it. Symbol names are
// greppable, survive edits above them, and fail loudly (grep finds nothing)
// when the thing is actually gone. Line numbers are kept ONLY for
// node_modules, where the dependency version is pinned in package.json and a
// bump is exactly when you want the reference re-checked, and for sibling
// specs and config in this same directory.
//
// THE VERIFIED DOM CONTRACT (read from the shipped source, not the plan):
//   - `.arrival-hero` wrapper carries `data-arrival-phase` — ArrivalHero.tsx's
//     `<div className="arrival-hero" data-arrival-phase={phase}>`, values from
//     ArrivalPhase (arrival-store.ts:3): loading | flight | arrived |
//     exploded | fallback.
//   - No API key (or a poster-tier device) → useArrivalGate blocks and
//     ArrivalHero returns null before ever mounting a canvas (its
//     `if (gateBlocked !== null) return null` early return) — and
//     FreshPage.tsx wraps it in `<Suspense fallback={null}>` layered over the
//     `<picture>`/`<img className="fr-hero-photo">`, so the photo alone
//     carries the hero.
//   - The Skip button, text exactly ArrivalHero.tsx's ARRIVAL_SKIP_LABEL =
//     "Skip the flight", renders only while phase === "flight" (its
//     `{phase === "flight" && …}` block, `button.arrival-skip`).
//   - "Open the Hall" (ArrivalHero.tsx's ARRIVAL_OPEN_HALL_LABEL) renders only
//     under `{phase === "arrived" && dollhouseReady && …}` — manifest ready
//     with a mesh in it — and calls the store's explode().
//   - Storey labels are `div.arrival-storey-label[data-arrival-storey=
//     {entry.bucket}]` (ArrivalHero.tsx's StoreyLabels), each holding the
//     storey name and a `button.arrival-storey-plan` whose aria-label is
//     `Plan ${entry.label}`, plus one `button.arrival-explode-close` that
//     calls the store's reassemble() back to "arrived".
//   - reduced motion short-circuits the phase machine: useArrivalGate
//     (use-arrival-gate.ts:46-50) flips the store's `reducedMotion` flag
//     once, on mount, from a live OS/emulated read of prefersReducedMotion();
//     arrival-store.ts's tilesReady() then goes loading -> arrived
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
//     which is exactly what a headless Chromium on SwiftShader is
//     (device-tier.ts:29-31). A keyed run there can never mount a hero, so
//     the keyed cases below detect that from the live WebGL renderer string
//     and skip with THAT reason named, instead of failing as if the key were
//     the problem. Both gates print their reason — a skip in this file
//     always says which of the two it was.
//
//     THE SECOND GATE USED TO SWALLOW THE FIRST, and that is why the ToS
//     assertion moved out from under both of them. This repo's
//     playwright.config.ts sets no launchOptions, so the DEFAULT run of this
//     file was SwiftShader on every machine — including a keyed developer's
//     workstation with a discrete GPU sitting idle. The keyed cases therefore
//     skipped everywhere, always, and the gating rework that produced these
//     two carefully-worded reasons had only changed which sentence got
//     printed while the suite stayed green having tested neither keyed thing.
//     Two changes, because one was not enough: `test.use` at the top of this
//     file now asks for the real GPU (measured — see THE ATTRIBUTION FIXTURE),
//     which un-skips the keyed cases on a workstation; and the attribution
//     assertion, which is a ToS guard and cannot be allowed to depend on
//     anybody's hardware, is no longer one of them.
//
// THE PHASE-DEPENDENT CASES DO NOT NEED A KEY. ArrivalHero self-gates to
// null without one, but arrival-dev-harness.ts's DEV-only `?arrivalPhase=`
// seam (double-guarded by import.meta.env.DEV, stripped from production
// builds) drives the store directly and — on its own — deliberately does NOT
// mount GoogleTilesStage, so the storey case below runs everywhere with no
// key and no billable tile request. Its companion `&arrivalTiles=stub`
// supplies a synthetic token for the ONE case that does need the tiles stage
// mounted (the attribution case), which answers tile.googleapis.com from its
// own route stub — see THE ATTRIBUTION FIXTURE. This is the same seam
// arrival-hero-controls.spec.ts uses, and it carries that file's caveat:
// under `E2E_WEB_SERVER=preview` the seam is compiled out, so the harness
// cases are dev-server cases (CI runs the dev server — playwright.config.ts
// :21-26 — and nothing in this repo sets preview mode).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

// The repo's playwright.config.ts passes no launch args, and this repo's other
// WebGL specs each supply their own (twin-visual.spec.ts:65-76,
// twin-performance.spec.ts:46-56). This file's are chosen for a different
// purpose than theirs: those pin SwiftShader for pixel determinism, these ask
// for the real GPU, because the hero's own gate refuses to fly on a software
// rasteriser at all (useArrivalGate blocks device tier "poster", and
// device-tier.ts:29-31 classifies "SwiftShader" as exactly that). MEASURED on
// this machine, 2026-08-28 — see THE ATTRIBUTION FIXTURE below for the full
// numbers — these flags move the reported renderer from SwiftShader to
// "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 … D3D11)", which is what lets the
// keyed cases at the bottom of this file actually execute on a workstation
// instead of skipping. They are NOT what makes the attribution guard run: a
// CI runner has no GPU for them to find, so that guard is driven through the
// DEV tiles seam instead and does not consult the renderer at all.
test.use({
  launchOptions: {
    args: ["--use-angle=default", "--enable-gpu"],
  },
});

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
 * ExplodedHall.tsx's ARRIVAL_STOREY_LABELS, restated as literals
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
 * GoogleTilesStage (ArrivalHero.tsx gates that child on apiToken !== null, not
 * on the harness), and a tiles `load-error` calls fail("tiles"), which
 * OVERRIDES the pinned phase and drops the hero into "fallback"
 * (arrival-store.ts's fail()). Measured, not theorised: with a key installed
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

// ---------------------------------------------------------------------------
// THE ATTRIBUTION FIXTURE — Google's own tile pipeline, answered locally, so
// the ToS assertion runs on a machine with no key and no GPU.
//
// WHY THIS EXISTS. Everything below the "keyed" heading further down needs a
// paid Map Tiles key AND a non-poster GPU, and the second of those two gates
// used to fire on every default run of this file on every machine, so the
// attribution assertion — the guard on the exact ToS defect commit e51b9475
// fixed — had never once executed. MEASURED here on 2026-08-28 with this
// repo's own @playwright/test 1.59.1, on a machine holding an RTX 4090:
//
//   chromium.launch()                             -> "ANGLE (Google, Vulkan
//     no launchOptions                                1.3.0 (SwiftShader
//                                                     Device (Subzero) …))"
//   chromium.launch({ args: ["--use-angle=default",
//                            "--enable-gpu"] })   -> "ANGLE (NVIDIA, NVIDIA
//                                                     GeForce RTX 4090 …
//                                                     D3D11)"
//
// So the reviewer's suggested flags do work — they are applied at the top of
// this file — and they are still not the fix, because a CI runner has no
// discrete GPU for them to find. An assertion that runs only where there is a
// GPU is an assertion that does not run in CI, which is the one place a ToS
// guard has to run. Hence this fixture: the DEV `&arrivalTiles=stub` seam
// (arrival-dev-harness.ts) mounts GoogleTilesStage with a synthetic token at
// ANY device tier, and the stubs below answer every request it makes. Nothing
// here reaches Google, and nothing here is billable.
//
// WHAT MAKES THE CREDITS APPEAR — the thing worth writing down, because it is
// not obvious and it is what a future edit will break. GoogleCloudAuthPlugin
// .getAttributions() returns NOTHING AT ALL unless `this.tiles.visibleTiles
// .size > 0` (GoogleCloudAuthPlugin.js:110). So a stub that merely answers the
// root request — like stubGoogleTilesRootAsEmpty above, which is deliberately
// empty because its case is about storeys, not Google — produces an empty
// overlay and would make this assertion vacuous in a new way. The tileset
// below therefore has to get one real tile LOADED and VISIBLE:
//
//   - its root carries `content.uri` with a `?session=` parameter, because
//     that is where GoogleCloudAuth.getSessionToken() digs the session token
//     out of the first response (GoogleCloudAuth.js:171-197);
//   - its bounding sphere is centred on the Trades Hall anchor's real ECEF
//     position, so that after ReorientationPlugin pins that point to the scene
//     origin the sphere sits around the camera rail and passes the frustum
//     test rather than being culled on the other side of the planet;
//   - the content is a real GLB with a real triangle, so the tile genuinely
//     loads rather than erroring into fail("tiles");
//   - and that GLB carries `asset.copyright`, because the text credit's value
//     is read from the GLTF PARSE RESULT — `tile.engineData.metadata?.asset
//     ?.copyright` (GoogleCloudAuthPlugin.js:99), where `metadata` is the
//     whole gltf object three's TilesRenderer got back (TilesRenderer.js:
//     773-782, 869) — NOT from the tileset JSON, which is the natural place to
//     look and the wrong one.
// ---------------------------------------------------------------------------

/** Every request the tiles stage can make, whatever the plugin appends. */
const GOOGLE_TILES_ANY_ROUTE = "https://tile.googleapis.com/**";

/** The seam that mounts GoogleTilesStage without a key — arrival-dev-harness.ts. */
const HARNESS_TILES_QUERY = "arrivalTiles=stub";

/** WGS84 as 3d-tiles-renderer defines it — core/renderer/constants.js:42,55
 *  (`WGS84_HEIGHT = a(1 − f)`, f = 1/298.257223563). */
const WGS84_A = 6378137;
const WGS84_B = 6356752.314245179;

/** trades-hall-anchor.ts's TRADES_HALL_ANCHOR, restated for the same reason as
 *  every other literal in this file: that module is imported by Vite modules
 *  and this spec runs in Node. Its composition is pinned by its own tests. */
const ANCHOR_LAT_DEG = 55.859;
const ANCHOR_LON_DEG = -4.2474;
const ANCHOR_HEIGHT_M = 20;

/**
 * The anchor in ECEF metres, by the SAME arithmetic the renderer uses, so the
 * two cannot disagree: Ellipsoid.getCartographicToNormal builds the unit
 * normal from a Spherical at (φ = π/2 − lat, θ = lon) and swaps the three.js
 * frame to the geo frame — (x, y, z) = (z₃, x₃, y₃), which is exactly
 * (cos lat·cos lon, cos lat·sin lon, sin lat) — and
 * getCartographicToPosition then applies Cesium's radius²/gamma projection
 * plus height along that normal (Ellipsoid.js:259-276, 309-317; GeoUtils.js
 * :33-40, 76-80). Reproduced rather than imported because importing
 * 3d-tiles-renderer/three into this Node process would drag in three.
 */
function anchorEcef(): readonly [number, number, number] {
  const lat = (ANCHOR_LAT_DEG * Math.PI) / 180;
  const lon = (ANCHOR_LON_DEG * Math.PI) / 180;
  const normal: readonly [number, number, number] = [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
  const scaled: readonly [number, number, number] = [
    normal[0] * WGS84_A ** 2,
    normal[1] * WGS84_A ** 2,
    normal[2] * WGS84_B ** 2,
  ];
  const gamma = Math.sqrt(
    normal[0] * scaled[0] + normal[1] * scaled[1] + normal[2] * scaled[2],
  );
  return [
    scaled[0] / gamma + normal[0] * ANCHOR_HEIGHT_M,
    scaled[1] / gamma + normal[1] * ANCHOR_HEIGHT_M,
    scaled[2] / gamma + normal[2] * ANCHOR_HEIGHT_M,
  ];
}

/**
 * 2 km around the anchor. The rail's own start pose is 3.7 km out looking at
 * the origin (camera-rail.ts:81) and its held arrival pose is 75 m out, so a
 * sphere this size is inside the frustum from the first frame to the last —
 * the tile is visible for the whole flight, not just part of it.
 */
const STUB_TILE_RADIUS_M = 2000;

/** Distinct enough that finding it in the overlay is finding OUR credit. */
const STUB_TILE_COPYRIGHT = "E2E stub imagery credit";

/** The token GoogleCloudAuth digs out of the root response's content URI. */
const STUB_SESSION_TOKEN = "E2E-STUB-SESSION";

const STUB_TILE_FILENAME = "e2e-stub-tile.glb";

/**
 * A real GLB with one triangle and a `copyright` in its glTF asset block —
 * the field the text credit is actually read from (see the header above).
 */
function googleTileGlbBytes(): Buffer {
  const positions = [-200, -200, 0, 200, -200, 0, 0, 200, 0];
  const bin = Buffer.alloc(positions.length * 4);
  positions.forEach((value, i) => {
    bin.writeFloatLE(value, i * 4);
  });
  return glbBytes(
    {
      asset: { version: "2.0", copyright: STUB_TILE_COPYRIGHT },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: "e2e-stub-tile" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126, // FLOAT
          count: 3,
          type: "VEC3",
          min: [-200, -200, 0],
          max: [200, 200, 0],
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, target: 34962 }],
      buffers: [{ byteLength: bin.byteLength }],
    },
    bin,
  );
}

const STUB_TILE_GLB_BYTES = googleTileGlbBytes();

/** Answers every tile.googleapis.com request with the fixture above. */
async function stubGoogleTilesAsOneVisibleTile(page: Page): Promise<void> {
  const [x, y, z] = anchorEcef();
  const tileset = {
    asset: { version: "1.1" },
    geometricError: 100,
    root: {
      boundingVolume: { sphere: [x, y, z, STUB_TILE_RADIUS_M] },
      // Zero, so the root is its own leaf: a screen-space error of 0 is below
      // any errorTarget, so the traversal displays it instead of asking for
      // children this fixture deliberately does not have.
      geometricError: 0,
      refine: "REPLACE",
      content: { uri: `${STUB_TILE_FILENAME}?session=${STUB_SESSION_TOKEN}` },
    },
  };

  await page.route(GOOGLE_TILES_ANY_ROUTE, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/root.json")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(tileset),
      });
      return;
    }
    if (pathname.endsWith(`/${STUB_TILE_FILENAME}`)) {
      await route.fulfill({
        status: 200,
        contentType: "model/gltf-binary",
        body: STUB_TILE_GLB_BYTES,
      });
      return;
    }
    // Loud rather than silent: an unrecognised Google request means the
    // fixture has drifted from what the library asks for, and a 404 here
    // surfaces as a tiles failure the assertions cannot miss.
    await route.fulfill({ status: 404, contentType: "text/plain", body: pathname });
  });
}

/**
 * A decodable PNG at the brand mark's exact URL.
 *
 * arrival-config.ts's GOOGLE_MAPS_ATTRIBUTION_LOGO_URL points at a file that
 * IS NOT IN THE REPO YET — its own NEEDS_CONTEXT note explains why (Google's
 * mark ships as a downloadable archive, and choosing the variant is a human
 * call), and packages/web/public/images/brand/ confirms it. That gap belongs
 * to Task 16, and it is NOT what the unconditional case is about: that case is
 * about whether the hero still EMITS the logo credit, which is the thing
 * e51b9475 fixed and the thing a refactor can silently undo.
 *
 * So the route is answered with a real committed PNG — the House coat-of-arms
 * mark, standing in purely as bytes a browser can decode — and `naturalWidth`
 * then measures what it is meant to: that the overlay pointed the browser at
 * the exact URL the hero configured, and that what came back rendered. The
 * keyed case further down leaves this route UNSTUBBED, so a machine with a
 * real key still tests the real asset's existence.
 */
const LOGO_STAND_IN_FILE = fileURLToPath(
  new URL("../public/images/brand/coat-of-arms-mark.png", import.meta.url),
);

async function stubGoogleAttributionLogo(page: Page): Promise<void> {
  await page.route(`**${GOOGLE_LOGO_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", path: LOGO_STAND_IN_FILE }),
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
  // delay the product imposes: once the chunk resolves, ArrivalHero's
  // gate-blocked early return fires synchronously.
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
  // (ArrivalHero.tsx's dollhouseReady) — so reaching it at all already
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
// 4. The Google ToS contract — BOTH required credits, on every machine.
//
//    This is the guard on commit e51b9475's defect (logoUrl never passed, so
//    the brand credit was never emitted at all), and until now it lived only
//    in the keyed case below, which needs a paid key AND a discrete GPU and
//    therefore skipped on every default run anywhere. It runs here instead:
//    real GoogleTilesStage, real GoogleCloudAuthPlugin, real
//    TilesAttributionOverlay, real browser — with tile.googleapis.com answered
//    from THE ATTRIBUTION FIXTURE above, so no key, no GPU tier and no network
//    are involved. The keyed case keeps the two things this cannot cover: the
//    live service, and whether the real brand-mark file has been committed.
// ---------------------------------------------------------------------------

test("Google's two required credits both ship — no key, no GPU, no network", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubTwinBundleAsProduction(page);
  await stubGoogleTilesAsOneVisibleTile(page);
  await stubGoogleAttributionLogo(page);

  // "flight" rather than "arrived": ArrivalHero runs the canvas at
  // frameloop="always" only while the flight (or an unsettled explode spring)
  // is running, and the tiles traversal that marks a tile VISIBLE — the
  // precondition for any attribution at all — happens in that frame loop.
  await page.goto(`/?arrivalPhase=flight&${HARNESS_TILES_QUERY}`);

  const hero = page.locator(".arrival-hero");
  await expect(hero).toHaveAttribute("data-arrival-phase", "flight", { timeout: 20_000 });

  const overlay = hero.locator('[id^="class_"]').first();
  await expect(overlay).toBeAttached();

  // (1) THE BRAND MARK. 3d-tiles-renderer renders an `image` attribution as
  // <div><img src=…> (TilesAttributionOverlay.jsx:89-112), and
  // GoogleCloudAuthPlugin pushes that entry ONLY when logoUrl is set
  // (`if ( this.logoUrl )`, GoogleCloudAuthPlugin.js:118-125). Asserting the
  // container — which the library renders unconditionally — is what made the
  // previous version of this assertion unable to fail.
  const logo = overlay.locator(`img[src="${GOOGLE_LOGO_URL}"]`);
  await expect(logo).toBeAttached({ timeout: 30_000 });

  // …and it is a mark, not a broken image: a URL that 404s renders as nothing
  // at all, and the ToS requirement is then as unmet as when no credit was
  // emitted. See stubGoogleAttributionLogo for what is being measured here and
  // what is deliberately not.
  await expect
    .poll(async () => logo.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  // (2) THE TEXT/COPYRIGHT CREDIT — the other of the two attributions Google's
  // policies require. Its value comes from the loaded tile's own glTF
  // asset.copyright, so asserting the fixture's exact string proves the whole
  // path (tile loaded → visible → copyright collected → rendered), not merely
  // that some text is present.
  await expect(overlay).toContainText(STUB_TILE_COPYRIGHT);
});

// ---------------------------------------------------------------------------
// 5. Keyed — the only two things that genuinely need Google's live service.
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
      "consulted (use-arrival-gate.ts:52-54), so no keyed case can run on this machine. " +
      "This file already asks for the real GPU (see test.use at the top), so reaching " +
      "here means there was none to reach — a CI runner, typically. Google's ToS guard " +
      "does NOT depend on this: it runs unconditionally, further up.",
  );

  const hero = page.locator(".arrival-hero");
  // First-idle on Google's real tileset is a genuine network round trip —
  // generous but bounded, matching this repo's posture for live-network waits
  // (trades-hall-visual.spec.ts:219 allows 120_000ms for a real R2 asset).
  await expect(hero).toHaveAttribute("data-arrival-phase", "flight", { timeout: 45_000 });

  // THE GOOGLE ToS CONTRACT, against the LIVE service. The unconditional case
  // above already proves the hero emits both credits, on any machine — this
  // one adds the two things a local stub structurally cannot: that Google's
  // real tileset drives the same overlay, and that the brand mark is a file
  // that actually EXISTS in this repo (the logo route is deliberately not
  // stubbed here, unlike above).
  const overlay = hero.locator('[id^="class_"]').first();
  await expect(overlay).toBeAttached();

  const logo = overlay.locator(`img[src="${GOOGLE_LOGO_URL}"]`);
  await expect(logo).toBeAttached({ timeout: 30_000 });
  // The mark has to be a mark, not a broken image: a 404 renders as nothing
  // at all and the ToS requirement is unmet just as completely as when the
  // credit was never emitted. THIS IS THE LIVE TRIP-WIRE ON THE UNCOMMITTED
  // ASSET — arrival-config.ts's own NEEDS_CONTEXT note says the file is not
  // in the repo yet, so whoever first runs this file with a real key is the
  // person who has to land it before Task 16, and this line is what tells
  // them. It is deliberately the ONE assertion in this spec that a stub does
  // not answer for.
  expect(await logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // …and the text/copyright credit beside it, which is the OTHER of the two
  // attributions Google's policies require.
  const credit = overlay.locator("div", { hasText: /\S/ }).first();
  await expect(credit).toBeAttached();
  expect((await overlay.innerText()).trim().length).toBeGreaterThan(0);

  // Skip is WCAG 2.2.2's pause control for an 11-second automatic animation;
  // it exists only during flight (ArrivalHero.tsx's phase === "flight" block).
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
      "consulted (use-arrival-gate.ts:52-54), so no keyed case can run on this machine. " +
      "This file already asks for the real GPU (see test.use at the top), so reaching " +
      "here means there was none to reach — a CI runner, typically. Google's ToS guard " +
      "does NOT depend on this: it runs unconditionally, further up.",
  );

  const hero = page.locator(".arrival-hero");
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived", { timeout: 45_000 });

  const phases = await arrivalPhasesSeen(page);
  expect(phases).toContain("arrived");
  expect(phases).not.toContain("flight");
});
