import { expect, test, type Page } from "@playwright/test";
import { TWIN_FIXTURE_MANIFEST_EQUIRECT } from "../src/twin/__fixtures__/twin-fixture.js";

// ---------------------------------------------------------------------------
// The Arrival hero — /'s live "fly-in" intro over the static hero photo
// (packages/web/src/pages/landing/arrival/). This spec proves the phase
// machine behaves in a REAL browser, and — the one guarantee that matters
// most, since it is what keeps the homepage from ever breaking — that a
// keyless environment (today's CI, and every dev machine without a Google
// Map Tiles key in packages/web/.env.local) renders nothing at all and the
// plain <img> carries the page.
//
// THE VERIFIED DOM CONTRACT (read from the shipped source, not the plan):
//   - `.arrival-hero` wrapper carries `data-arrival-phase` — ArrivalHero.tsx
//     :332-334 (`<div className="arrival-hero" data-arrival-phase={phase}>`),
//     values from ArrivalPhase (arrival-store.ts:3): loading | flight |
//     arrived | exploded | fallback.
//   - No API key (or a poster-tier device) → ArrivalHero returns null before
//     ever mounting a canvas — ArrivalHero.tsx:302-312 — and FreshPage.tsx
//     :747-749 wraps it in `<Suspense fallback={null}>` layered over the
//     `<picture>`/`<img className="fr-hero-photo">` at FreshPage.tsx:712-742,
//     so the photo alone carries the hero.
//   - The Skip button, text exactly ARRIVAL_SKIP_LABEL = "Skip the flight"
//     (ArrivalHero.tsx:82), renders only while phase === "flight"
//     (ArrivalHero.tsx:361-371).
//   - reduced motion short-circuits the phase machine: useArrivalGate (use-
//     arrival-gate.ts:46-50) flips the store's `reducedMotion` flag once, on
//     mount, from a live OS/emulated read of prefersReducedMotion(); arrival-
//     store.ts's tilesReady() (:28-34) then goes loading -> arrived DIRECTLY
//     in one synchronous `set()` when that flag is true, never touching
//     "flight" — there is no intermediate tick where flight is momentarily
//     true. Case 3 below still proves this by watching phase HISTORY, not
//     just the final value, because a browser round trip against a real
//     network is exactly the kind of thing that can surprise a "the code
//     reads atomic" argument, and the E2E suite is not for taking that on
//     faith.
//   - "Open the Hall" (ARRIVAL_OPEN_HALL_LABEL = "Open the Hall",
//     ArrivalHero.tsx:88) renders only in "arrived" (:372-383) and calls
//     explode() (arrival-store.ts:41-43), flipping phase to "exploded".
//   - Storey labels carry `data-arrival-storey={entry.bucket}`
//     (ArrivalHero.tsx:184-188), each with a "Plan this room" button whose
//     aria-label is `Plan ${entry.label}` (:206-213), plus one "Close"
//     button (:218-229) that calls reassemble() back to "arrived".
//   - The Google attribution overlay (a ToS requirement — GoogleTilesStage
//     .tsx:20-28's own header comment: "it ships in every phase and no prop
//     may hide it") is `<TilesAttributionOverlay />`, unconditionally inside
//     `<TilesRenderer>` (GoogleTilesStage.tsx:134-140) — never gated on
//     phase. Its rendered DOM is a plain `<div>` a THIRD-PARTY library
//     (3d-tiles-renderer) appends as a sibling of the WebGL <canvas>, via a
//     separate React root (CanvasDOMOverlay.jsx, installed package
//     node_modules/3d-tiles-renderer/src/r3f/components/CanvasDOMOverlay.jsx
//     :14-66) — so it exists in the live DOM but is invisible to anything
//     that only reads ArrivalHero's own JSX. The one thing about it that IS
//     deterministic across mounts is its id prefix: TilesAttributionOverlay
//     .jsx:67 sets `id={'class_' + randomID()}` — the random suffix differs
//     every mount, the "class_" prefix never does. `[id^="class_"]` is
//     therefore the only stable selector for this element without adding a
//     data-* hook to GoogleTilesStage.tsx (not done here — see the report).
//
// THE GPU / SERIAL RECIPE (matched from the twin specs in this same
// directory — twin-visual.spec.ts:78-83, plan-room-runtime-default.spec.ts
// :27-30, public-config-flow.spec.ts:27-30 all state the same policy): a
// live WebGL context streaming real network imagery, run concurrently with
// this repo's OTHER WebGL-heavy specs under Playwright's fullyParallel
// default, measures the test runner's GPU contention rather than this
// feature — so this spec keeps `mode: "serial"` and lives in its OWN file,
// never sharing a file with twin-visual.spec.ts or plan-room-resolve.spec.ts.
// Unlike those specs, nothing here calls `page.screenshot()`/canvas
// `.screenshot()` (no ReadPixels), so the "no evaluate after a heavy
// readback" half of that recipe does not apply to this file — noted for the
// next person who copies this file as a template and adds one.
//
// KEY GATING. VITE_GOOGLE_MAPS_TILES_KEY is absent in CI and on every dev
// machine today (arrival-config.ts:1-13's own comment: "Absent in dev until
// the key lands in packages/web/.env.local"). Vite only exposes VITE_-
// prefixed vars to `import.meta.env` client-side (vite.config.ts sets no
// custom envPrefix, so the default applies), and playwright.config.ts's
// `webServer` spawns `pnpm dev` as a CHILD PROCESS of whatever runs
// Playwright — so a key exported in the invoking shell before `pnpm --filter
// @omnitwin/web e2e` reaches both this test file's `process.env` AND the
// dev server's `import.meta.env` identically. That is also this repo's own
// established convention for a live/keyed integration case (trades-hall-
// visual.spec.ts:151-155's `E2E_EXPECT_PRODUCTION_MANUAL_URL_DISABLED` and
// :209-213's `E2E_RECEPTION_ROOM_RUNTIME_PACKAGE`, production-smoke.spec.ts
// throughout): `test.skip(condition, reason)` as the test body's first line,
// never a config-level exclusion, so a developer who DOES have the key gets
// a real run with zero edits. The two keyless cases below carry NO such
// skip — they are the ones proving the homepage cannot break, and they must
// run unconditionally, everywhere, always.
//
// HallHandoff (mounted once phase reaches "arrived") fetches the trades-hall
// twin/0 bundle from OUR OWN asset server (useTwinManifest.ts:48), nothing
// to do with Google — and that bundle is gitignored (twin-visual.spec.ts's
// own header: "the real 149-scan bundle does not exist on a CI checkout").
// The keyed cases below stub those two routes with the same synthetic twin
// fixture + minimal-GLB byte fixture every other twin e2e spec in this
// directory already uses (twin-visual.spec.ts, twin-walk.spec.ts,
// twin-performance.spec.ts, twin-tour.spec.ts, twin-tour-responsive.spec.ts
// each carry an identical, independently-duplicated copy of
// `minimalGlbBytes()` — this file follows that same established convention
// rather than introducing a new shared helper for a five-line function).
// Google's own tiles are deliberately left UNMOCKED: the point of a keyed
// case is to prove the real integration against the real service.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const TILES_KEY = process.env["VITE_GOOGLE_MAPS_TILES_KEY"];
const HAS_TILES_KEY = typeof TILES_KEY === "string" && TILES_KEY.trim().length > 0;
const TILES_KEY_SKIP_REASON =
  "needs a real VITE_GOOGLE_MAPS_TILES_KEY (see arrival-config.ts:6-13) exported before `pnpm dev` starts";

const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

/**
 * A valid, empty GLB 2.0 scene. Duplicated from the identical helper in
 * twin-visual.spec.ts (and three other twin specs in this directory) —
 * this repo's own established convention for this fixture is a small
 * per-file copy, not a shared helper.
 */
function minimalGlbBytes(): Buffer {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] }),
    "utf8",
  );
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + jsonChunk.byteLength, 8);
  header.writeUInt32LE(jsonChunk.byteLength, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jsonChunk]);
}

const MESH_BYTES = minimalGlbBytes();

/** Stubs the trades-hall twin/0 manifest + dollhouse GLB that HallHandoff
 *  fetches once phase reaches "arrived" — see the file header for why this
 *  has nothing to do with the Google key this file otherwise gates on. */
async function stubHallHandoffAssets(page: Page): Promise<void> {
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TWIN_FIXTURE_MANIFEST_EQUIRECT),
    }),
  );
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: MESH_BYTES }),
  );
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

declare global {
  interface Window {
    /** Every DISTINCT value data-arrival-phase has taken on `.arrival-hero`,
     *  in order — recorded by an init script installed before navigation, so
     *  the very first value (set the instant React first mounts the div) is
     *  never missed by a listener that starts too late. See
     *  watchArrivalPhases below. */
    __arrivalPhasesSeen?: string[];
  }
}

/**
 * Installs a MutationObserver, before navigation, that records the full
 * ordered history of `.arrival-hero`'s data-arrival-phase attribute. A
 * final-state check alone ("phase is now arrived") cannot prove case 3's
 * claim ("never passed through flight") — only a genuine history can.
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

// ---------------------------------------------------------------------------
// Case 1 — keyless (always runs; this is the guarantee that matters most).
// ---------------------------------------------------------------------------

test("keyless: the static hero photo carries the homepage, with no live Arrival mount", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");

  await expect(page.locator("img.fr-hero-photo")).toBeVisible();

  // ArrivalHero is lazy-loaded (FreshPage.tsx:136-138); give its chunk every
  // chance to have resolved and mounted before trusting its absence — once
  // it has, ArrivalHero.tsx:302-312 returns null synchronously (no key), so
  // this is closing a "hasn't downloaded yet" race, not waiting out a delay
  // the product itself imposes.
  await page.waitForTimeout(1_000);
  await expect(page.locator(".arrival-hero")).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("keyless + reduced motion: still just the static photo", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("img.fr-hero-photo")).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator(".arrival-hero")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Case 2 — reduced motion WITH a key: arrives without ever flying.
// ---------------------------------------------------------------------------

test("keyed + reduced motion: arrives without ever passing through flight", async ({ page }) => {
  test.skip(!HAS_TILES_KEY, TILES_KEY_SKIP_REASON);
  test.setTimeout(45_000);

  await stubHallHandoffAssets(page);
  await watchArrivalPhases(page);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/");

  const hero = page.locator(".arrival-hero");
  // First-idle on Google's real tileset is a genuine network round trip —
  // generous but bounded, matching this repo's own posture for live-network
  // waits (e.g. trades-hall-visual.spec.ts:219's 120_000ms for a real R2 asset).
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived", { timeout: 30_000 });

  const phases = await arrivalPhasesSeen(page);
  expect(phases).toContain("arrived");
  expect(phases).not.toContain("flight");
});

// ---------------------------------------------------------------------------
// Case 3 — the full keyed flow: skip, arrive, attribution, explode, close.
// ---------------------------------------------------------------------------

test("keyed: skip the flight, arrive, explode into storeys, close", async ({ page }) => {
  test.skip(!HAS_TILES_KEY, TILES_KEY_SKIP_REASON);
  test.setTimeout(60_000);

  await stubHallHandoffAssets(page);
  await page.goto("/");

  const hero = page.locator(".arrival-hero");

  // "Skip the flight" (ARRIVAL_SKIP_LABEL, ArrivalHero.tsx:82/369) exists
  // only during phase "flight" (ArrivalHero.tsx:361-371).
  await expect(hero).toHaveAttribute("data-arrival-phase", "flight", { timeout: 30_000 });
  const skipButton = hero.getByRole("button", { name: "Skip the flight", exact: true });
  await expect(skipButton).toBeVisible();
  await skipButton.click();

  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived");

  // The Google ToS attribution overlay — see the file header for why
  // `[id^="class_"]` is the only selector this element offers without a new
  // data-* hook: a third-party React root (CanvasDOMOverlay) appends a
  // sibling of the WebGL canvas whose id is `'class_' + randomID()`
  // (TilesAttributionOverlay.jsx:67), so the "class_" prefix is the one
  // deterministic part of it. Scoped to `hero` to prove it lives inside the
  // Arrival mount, matching GoogleTilesStage.tsx:134-140's actual nesting.
  await expect(hero.locator('[id^="class_"]').first()).toBeAttached();

  // "Open the Hall" (ARRIVAL_OPEN_HALL_LABEL, ArrivalHero.tsx:88/372-383)
  // calls explode() (arrival-store.ts:41-43).
  const openHall = hero.getByRole("button", { name: "Open the Hall", exact: true });
  await expect(openHall).toBeVisible();
  await openHall.click();

  await expect(hero).toHaveAttribute("data-arrival-phase", "exploded");
  // Storey labels: data-arrival-storey={entry.bucket} (ArrivalHero.tsx
  // :184-188), appended once ExplodedHall's spring crosses
  // LABEL_APPEAR_PROGRESS (ExplodedHall.tsx:156) — fast (EXPLODE_SPRING is
  // stiffness 120 / damping 20, ExplodedHall.tsx:130) but not synchronous
  // with the click, hence the timeout.
  await expect(page.locator("[data-arrival-storey]").first()).toBeVisible({ timeout: 10_000 });

  // "Close" (ArrivalHero.tsx:218-229) calls reassemble() back to "arrived".
  await hero.getByRole("button", { name: "Close", exact: true }).click();
  await expect(hero).toHaveAttribute("data-arrival-phase", "arrived");
});
