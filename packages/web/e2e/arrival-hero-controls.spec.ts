import { expect, test, type Page } from "@playwright/test";
import { TWIN_FIXTURE_MANIFEST_EQUIRECT } from "../src/twin/__fixtures__/twin-fixture.js";

// ---------------------------------------------------------------------------
// The Arrival hero's CONTROLS — are they actually reachable?
//
// This spec exists because two deliberate accessibility fixes were shipped
// dead. arrival.css positions "Skip the flight" and "Open the Hall" against
// .arrival-hero, which fills .fr-hero-frame — but fresh.css pulls
// .fr-hero-panel UP over that frame's bottom edge, and the panel is OPAQUE
// (background: var(--fr-paper)) and paints ABOVE the whole arrival layer:
// both are positioned elements at z-index:auto, so tree order decides, and
// the panel is the later sibling. Neither file was wrong on its own. Neither
// owned the overlap. That is what made it invisible to review.
//
// The cost was real and user-facing:
//   - "Skip the flight" is WCAG 2.2.2's Pause/Stop/Hide control for an
//     11-second automatic animation. Buried, a visitor cannot stop it.
//   - "Open the Hall" is the ONLY DOM (keyboard/AT-reachable) route into the
//     explode; the 3D canvas raycast is a mouse-only extra.
//
// WHY PLAYWRIGHT AND NOT A UNIT TEST. "Painted underneath something opaque"
// is invisible to jsdom, which has no layout, no paint order and no hit
// testing — every existing ArrivalHero.test.tsx case found these buttons
// perfectly well while a real visitor could not touch them. Playwright's
// actionability check is the instrument that does know: it hit-tests the
// element's centre and refuses to click something another element intercepts.
// `click({ trial: true })` runs that full check and then does NOT click, so
// reachability is measured without dragging the 3D scene's downstream state
// into a CSS assertion. `topmostAt()` below adds the direct measurement —
// document.elementFromPoint at the control's centre — so a failure NAMES the
// element doing the covering instead of just timing out.
//
// HOW THE PHASES ARE REACHED WITHOUT A GOOGLE KEY. ArrivalHero self-gates to
// null when googleTilesApiKey() is null, and that key is absent in CI and on
// every dev machine — which is why every phase-dependent case in
// arrival.spec.ts carries a `test.skip(!HAS_TILES_KEY)`. A regression test for
// these controls that only runs on a machine holding a paid Map Tiles key is
// not a regression test, so this file drives the store through the DEV-only
// `?arrivalPhase=` seam (src/pages/landing/arrival/arrival-dev-harness.ts,
// double-guarded by import.meta.env.DEV and stripped from production builds).
// The seam bypasses the key gate but deliberately does NOT mount
// GoogleTilesStage, so what is measured here is the DOM overlay's geometry
// against the real fresh.css cascade — not the health of a billable
// third-party tile service. It runs everywhere, always, with no key.
//
// GPU / SERIAL RECIPE: same policy as arrival.spec.ts and the twin specs —
// a live WebGL context run under Playwright's fullyParallel default measures
// runner contention rather than this feature, so this file is `mode: "serial"`
// and lives on its own. Nothing here calls screenshot()/ReadPixels.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

const SKIP_LABEL = "Skip the flight";
const OPEN_HALL_LABEL = "Open the Hall";

/** The two viewports the assertions run at: a small phone, and a desktop. */
const VIEWPORTS = [
  { name: "390x740 (phone)", width: 390, height: 740 },
  { name: "1440x900 (desktop)", width: 1440, height: 900 },
] as const;

/**
 * A valid, empty GLB 2.0 scene. Duplicated from the identical helper in
 * arrival.spec.ts and four twin specs in this directory — this repo's own
 * established convention for this fixture is a small per-file copy, not a
 * shared helper.
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

/** Serves the trades-hall twin/0 bundle HallHandoff fetches once arrived. */
async function stubDollhouse(page: Page): Promise<void> {
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

/**
 * What the browser actually hits at the centre of `selector`.
 *
 * "SELF" when the element (or its own descendant) is topmost — i.e. genuinely
 * reachable. Otherwise a description of whatever is covering it, so a failure
 * reads "…was covered by div.fr-hero-panel" rather than an anonymous timeout.
 */
async function topmostAt(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) {
      return "MISSING";
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return "ZERO-SIZED";
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit === null) {
      return "OUTSIDE-VIEWPORT";
    }
    if (hit === el || el.contains(hit)) {
      return "SELF";
    }
    const cls = typeof hit.className === "string" && hit.className !== "" ? `.${hit.className}` : "";
    return `COVERED-BY:${hit.tagName.toLowerCase()}${cls}`;
  }, selector);
}

/** The measured overlap between .fr-hero-panel and .fr-hero-frame. */
async function heroGeometry(page: Page): Promise<{
  readonly panelMarginTop: string;
  readonly overlapPx: number;
  readonly panelSpansFrameWidth: boolean;
}> {
  return page.evaluate(() => {
    const frame = document.querySelector(".fr-hero-frame");
    const panel = document.querySelector(".fr-hero-panel");
    if (frame === null || panel === null) {
      throw new Error("hero frame or panel missing");
    }
    const frameRect = frame.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      panelMarginTop: getComputedStyle(panel).marginTop,
      overlapPx: Math.round(frameRect.bottom - panelRect.top),
      panelSpansFrameWidth: Math.round(panelRect.width) >= Math.round(frameRect.width),
    };
  });
}

/** Loads `/` with the phase pinned, and waits for the hero to reach it. */
async function openHeroAt(page: Page, phase: string): Promise<void> {
  await page.goto(`/?arrivalPhase=${phase}`);
  await expect(page.locator(`.arrival-hero[data-arrival-phase="${phase}"]`)).toBeAttached({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// The geometry the bug lived in — recorded, not assumed.
// ---------------------------------------------------------------------------

test("the panel really does overlap the hero frame, at both viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto("/");
  await expect(page.locator("img.fr-hero-photo")).toBeVisible();
  const phone = await heroGeometry(page);
  // ≤760px: fresh.css redefines --fr-hero-panel-lift to -48px.
  expect(phone.panelMarginTop).toBe("-48px");
  expect(phone.overlapPx).toBe(48);
  // And at this width the panel spans the FULL frame, so the bottom band is
  // covered edge to edge — which is why even the bottom-RIGHT skip pill,
  // which clears the 720px-wide panel on desktop, was buried here.
  expect(phone.panelSpansFrameWidth).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("img.fr-hero-photo")).toBeVisible();
  const desktop = await heroGeometry(page);
  // clamp(-72px, -8vw, -110px) has min > max over negatives, so per CSS
  // Values 4 it resolves to the min — a constant -72px, NOT the -110px the
  // authoring order suggests. Pinned because arrival.css's clearance is
  // derived from this exact token.
  expect(desktop.panelMarginTop).toBe("-72px");
  expect(desktop.overlapPx).toBe(72);
  expect(desktop.panelSpansFrameWidth).toBe(false);
});

// ---------------------------------------------------------------------------
// CRITICAL A — both controls reachable at every supported viewport.
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test(`"${SKIP_LABEL}" is visible and clickable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubDollhouse(page);
    await openHeroAt(page, "flight");

    const skip = page.getByRole("button", { name: SKIP_LABEL });
    await expect(skip).toBeVisible();

    // The measurement that names the culprit when it regresses.
    expect(await topmostAt(page, ".arrival-skip")).toBe("SELF");

    // The full actionability check — including the hit-target test that a
    // covered element fails — without performing the click.
    await skip.click({ trial: true, timeout: 5_000 });
  });

  test(`"${OPEN_HALL_LABEL}" is visible and clickable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubDollhouse(page);
    await openHeroAt(page, "arrived");

    const openHall = page.getByRole("button", { name: OPEN_HALL_LABEL });
    await expect(openHall).toBeVisible();
    expect(await topmostAt(page, ".arrival-open-hall")).toBe("SELF");
    await openHall.click({ trial: true, timeout: 5_000 });
  });
}

test("a real click on the skip control actually stops the flight", async ({ page }) => {
  // Trial clicks prove reachability; this proves the control is still WIRED —
  // that the fix moved a live button, not a decorative one.
  await page.setViewportSize({ width: 390, height: 740 });
  await stubDollhouse(page);
  await openHeroAt(page, "flight");

  await page.getByRole("button", { name: SKIP_LABEL }).click({ timeout: 5_000 });

  await expect(page.locator('.arrival-hero[data-arrival-phase="arrived"]')).toBeAttached();
  await expect(page.getByRole("button", { name: SKIP_LABEL })).toHaveCount(0);
});

test("a real click on the invitation opens the Hall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await stubDollhouse(page);
  await openHeroAt(page, "arrived");

  await page.getByRole("button", { name: OPEN_HALL_LABEL }).click({ timeout: 5_000 });

  await expect(page.locator('.arrival-hero[data-arrival-phase="exploded"]')).toBeAttached();
});

test("the controls stay clear of the panel across a viewport resize", async ({ page }) => {
  // The clearance is derived from a token fresh.css redefines at 760px, so
  // the breakpoint itself is a place the two files could drift apart again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubDollhouse(page);
  await openHeroAt(page, "arrived");
  expect(await topmostAt(page, ".arrival-open-hall")).toBe("SELF");

  for (const width of [820, 760, 700, 500, 390]) {
    await page.setViewportSize({ width, height: 740 });
    expect(await topmostAt(page, ".arrival-open-hall")).toBe("SELF");
  }
});

// ---------------------------------------------------------------------------
// CRITICAL B — no control for a reveal that cannot load.
// ---------------------------------------------------------------------------

test("production's broken manifest: the invitation is never offered", async ({ page }) => {
  // THE REAL PRODUCTION SHAPE. packages/web/public/twin is gitignored, so the
  // manifest request hits the SPA rewrite and comes back as index.html with a
  // 200 — the fetch "succeeds" and only fails when parsed as JSON. That is the
  // documented reason FRESH_TOUR_ENABLED is false today. HallHandoff already
  // self-gated to null for it; "Open the Hall" did not, leaving a live control
  // on the homepage that swapped in a Close button, stole focus, and revealed
  // nothing at all.
  await page.setViewportSize({ width: 390, height: 740 });
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Venviewer</title></head><body></body></html>",
    }),
  );

  await openHeroAt(page, "arrived");

  // The hero itself is fine — the fly-in without the dollhouse is a complete,
  // valid experience, and the arrival layer must still be there carrying it.
  await expect(page.locator(".arrival-hero")).toBeVisible();
  // But nothing may offer to open what cannot open.
  await expect(page.getByRole("button", { name: OPEN_HALL_LABEL })).toHaveCount(0);
});

test("no dead doors to the walkthrough anywhere on the arrival layer", async ({ page }) => {
  // FreshPage already gates its own two /tour CTAs on FRESH_TOUR_ENABLED
  // (fresh.test.tsx pins that). The arrival layer was added later and
  // navigated to /tour ungated, reintroducing on the hero the exact dead door
  // the flag exists to prevent.
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubDollhouse(page);
  await openHeroAt(page, "arrived");

  await expect(page.locator('a[href="/tour"]')).toHaveCount(0);
  await expect(page.locator('a[href^="/tour"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The invariant that outranks everything above.
// ---------------------------------------------------------------------------

test("with no harness and no key, the static photo still carries the page", async ({ page }) => {
  // The seam must not change normal operation in ANY way — this is the same
  // guarantee arrival.spec.ts opens with, re-asserted here so a future edit to
  // the harness cannot quietly mount a keyless canvas on the live homepage.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator("img.fr-hero-photo")).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator(".arrival-hero")).toHaveCount(0);
});
