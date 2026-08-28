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
// CRITICAL B — no control for a reveal that cannot load, and no dead end
// where the reveal would have been.
// ---------------------------------------------------------------------------

test("production's broken manifest: no invitation, and no dead end", async ({ page }) => {
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

  // Nothing may offer to open what cannot open.
  await expect(page.getByRole("button", { name: OPEN_HALL_LABEL })).toHaveCount(0);

  // …AND NOBODY MAY BE LEFT THERE (edge review). The previous version of this
  // case asserted the opposite of the line below — "the arrival layer must
  // still be there carrying it" — on the reasoning that a fly-in without the
  // dollhouse is a complete experience. It is not, and this is the shape that
  // proves it: an opaque canvas of Google photogrammetry parked over
  // img.fr-hero-photo, with no dollhouse behind it, no invitation to open one,
  // no Skip (flight-only) and no Close (exploded-only) — not one control on
  // screen, and the venue photograph the page is built around hidden behind a
  // melty approximation of the same building until the visitor reloads.
  //
  // So the arrival RESOLVES: it holds the landing for a beat
  // (ARRIVAL_NO_TWIN_HOLD_MS, arrival-config.ts) and then dissolves through
  // the ordinary spec §6 fade. The hero really leaves the DOM, and what is
  // underneath it is the photograph — which is the whole guarantee.
  await expect(page.locator(".arrival-hero")).toHaveCount(0, { timeout: 15_000 });

  const photo = page.locator("img.fr-hero-photo");
  await expect(photo).toBeVisible();
  // A decoded photograph, not a broken image with alt text and a box.
  expect(await photo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test("no dead doors to the walkthrough anywhere on the arrival layer", async ({ page }) => {
  // FreshPage already gates its own two /tour CTAs on FRESH_TOUR_ENABLED
  // (fresh.test.tsx pins that). The arrival layer was added later and
  // navigated to /tour ungated, reintroducing on the hero the exact dead door
  // the flag exists to prevent.
  //
  // THIS CASE USED TO GUARD NOTHING, and the way it failed is worth keeping,
  // because it is the failure mode a reader will reproduce next. It asserted
  // `a[href="/tour"]` had count 0 — while the dead door it was written to stop
  // was never an anchor at all. Restored from b2c5df48^ (ArrivalHero.tsx's
  // StoreyLabels), verbatim, this is what it looked like:
  //
  //     <button type="button" className="arrival-storey-name"
  //             onClick={() => { void navigate("/tour"); }}>
  //       {entry.label}
  //     </button>
  //
  // A <button> calling react-router's navigate() puts no href in the document,
  // so the old assertion was true before the fix and true after it. Worse, it
  // ran at phase "arrived", where StoreyLabels renders nothing at all — so
  // there was no storey name in the DOM for it to be right or wrong about.
  // MEASURED 2026-08-28 by putting that exact hunk back: the old two lines
  // still passed with the dead door live, and the assertions below went red.
  // Both defects are addressed — the phase is now "exploded" (where the labels
  // exist), and what is asserted is the ELEMENT and the BEHAVIOUR, not an href
  // the bug never had.
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubDollhouse(page);
  await openHeroAt(page, "exploded");

  // The anti-vacuity control. Everything below is a claim ABOUT the storey
  // name, so the storey name has to be here for any of it to mean anything —
  // this is the assertion the old version was missing, and the reason it could
  // pass over a document containing no labels at all.
  const names = page.locator(".arrival-storey-name");
  await expect(names.first()).toBeVisible({ timeout: 15_000 });

  // 1. Inert text, not a control. With the walkthrough unpublished the name
  //    still LABELS the storey; it just must not offer to open it.
  await expect(page.locator("button.arrival-storey-name")).toHaveCount(0);
  // `exact` is load-bearing, not decoration: getByRole's `name` matches by
  // SUBSTRING by default, and "Plan Reception Room & Robert Adam Room" — the
  // live control that must survive — contains the storey name. Without it this
  // assertion would be red for the right-behaving page.
  await expect(
    page.getByRole("button", { name: EXPECTED_STOREY_LABEL, exact: true }),
  ).toHaveCount(0);

  // 2. …and clicking it really goes nowhere. Assertion 1 says the door is not
  //    in the document; this says the room behind it is not reachable by the
  //    click either, which is the visitor-facing fact.
  await names.first().click();
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe("/");

  // 3. No anchor form of the same door, now or later — the original assertion,
  //    kept because a future edit could reasonably reach for <Link to="/tour">
  //    and this is the only line here that would notice.
  await expect(page.locator('a[href^="/tour"]')).toHaveCount(0);

  // The positive control: the storey label is not inert BECAUSE the overlay is
  // broken. "Plan this room" is the live route out of the explode and is still
  // a real button, so assertion 1 is measuring the gate, not an absent
  // overlay.
  await expect(
    page.getByRole("button", { name: `Plan ${EXPECTED_STOREY_LABEL}` }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// THE CLEARANCE TRIP-WIRE — debt, deliberately pinned before it becomes a bug.
//
// The storey labels are the third thing arrival.css positions inside
// .fr-hero-frame, and unlike "Skip the flight" and "Open the Hall" they were
// never buried: measured across the four viewports below they clear
// .fr-hero-panel's top edge by a real margin today (the numbers are in the
// constant's doc comment). So this is NOT a live defect, and it is written as
// a trip-wire rather than a fix.
//
// It exists because of where that margin comes from. The labels are not
// positioned by CSS at all — each is placed at a PROJECTED 3D anchor,
// recomputed every frame from its storey bucket's centroid through the
// placement matrix (ExplodedHall.tsx). Their clearance is therefore an output
// of twin-placement geometry, not of a stylesheet, and Task 8's twin-placement
// calibration moves exactly that geometry. Nothing else in this repo would
// notice if a calibration nudge walked a label down into the opaque panel —
// the same defect, in the same band, that b2c5df48 just fixed for the two
// buttons, arriving by a different road.
// ---------------------------------------------------------------------------

/**
 * The one storey label this file's fixture produces.
 *
 * TWIN_FIXTURE_MANIFEST_EQUIRECT puts all four of its nodes on ONE floor, so
 * storeyFloors() has a single entry and there is exactly one bucket — bucket
 * 0 — which takes ARRIVAL_STOREY_LABELS[0] (ExplodedHall.tsx's
 * storeyLabelFor). The name is therefore the LOWEST storey's copy regardless
 * of which floor the fixture's nodes claim, which is the component's own
 * bucket-indexed behaviour and not a fact about this fixture's geometry.
 * (arrival.spec.ts is where the real building's TWO storeys and their correct
 * pairing are pinned; this file's subject is the overlay's geometry against
 * fresh.css, for which one label is enough and a second would only add a
 * second thing to wait for.)
 */
const EXPECTED_STOREY_LABEL = "Reception Room & Robert Adam Room";

/**
 * The floor, in CSS pixels, under a storey label's clearance above
 * .fr-hero-panel's top edge.
 *
 * MEASURED, not chosen — settled runs of the four cases below, 2026-08-28:
 *
 *    390 × 740  (phone)          56.95 px
 *   1024 × 768  (small laptop)   38.34 px   ← the tightest
 *   1280 × 800  (laptop)         44.50 px
 *   1440 × 900  (desktop)        63.74 px
 *
 * The margin does NOT shrink monotonically with width, which is the reason
 * four viewports and not two: the panel's lift token steps at 760px
 * (fresh.css:1301, −48px instead of −72px) while the projected label height
 * tracks the canvas, so the worst case is in the middle of the range, not at
 * either end. Testing only the phone and the desktop would have missed it.
 *
 * 24 px sits ~37% below the tightest of those and well above zero. It is not a
 * design bar for how much air a label should have; it is the line at which
 * "the label is about to go under the opaque panel" stops being theoretical. A
 * calibration that shaves the margin is allowed to. One that spends it all is
 * not, and this is what says so.
 *
 * PROVED TO CATCH, 2026-08-28, rather than assumed: with fresh.css's
 * --fr-hero-panel-lift temporarily set to −220px (a stand-in for the geometry
 * moving under the label rather than the label moving under the geometry, the
 * two being indistinguishable from here), the 1280 × 800 case went red on the
 * topmost probe with `COVERED-BY:span.fr-w` — naming the element inside the
 * panel that had taken the hit point.
 */
const STOREY_LABEL_CLEARANCE_MIN_PX = 24;

/** The four widths the clearance is measured at, narrow to wide. */
const CLEARANCE_VIEWPORTS = [
  { name: "390x740 (phone)", width: 390, height: 740 },
  { name: "1024x768 (small laptop)", width: 1024, height: 768 },
  { name: "1280x800 (laptop)", width: 1280, height: 800 },
  { name: "1440x900 (desktop)", width: 1440, height: 900 },
] as const;

interface StoreyLabelGeometry {
  /** Gap in CSS px between the label's bottom edge and the panel's top edge. */
  readonly clearancePx: number;
  /** topmostAt()'s vocabulary — "SELF" when the label is genuinely on top. */
  readonly topmost: string;
}

async function readStoreyLabelGeometry(page: Page): Promise<readonly StoreyLabelGeometry[]> {
  return page.evaluate(() => {
    const panel = document.querySelector(".fr-hero-panel");
    if (panel === null) {
      throw new Error("hero panel missing");
    }
    const panelTop = panel.getBoundingClientRect().top;
    return [...document.querySelectorAll(".arrival-storey-label")].map((label) => {
      const rect = label.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      let topmost = "OUTSIDE-VIEWPORT";
      if (hit !== null) {
        if (hit === label || label.contains(hit)) {
          topmost = "SELF";
        } else {
          const cls =
            typeof hit.className === "string" && hit.className !== "" ? `.${hit.className}` : "";
          topmost = `COVERED-BY:${hit.tagName.toLowerCase()}${cls}`;
        }
      }
      return { clearancePx: panelTop - rect.bottom, topmost };
    });
  });
}

/**
 * The geometry once the explode spring has stopped moving.
 *
 * The labels are repositioned every unsettled frame, so a single sample is a
 * sample of the animation and not of the layout — and a bare `expect.poll`
 * would pass on the first frame that happened to clear the bar mid-flight. Two
 * consecutive agreeing samples is what "settled" means here.
 */
async function settledStoreyLabelGeometry(page: Page): Promise<readonly StoreyLabelGeometry[]> {
  const deadline = Date.now() + 20_000;
  let previous: readonly StoreyLabelGeometry[] = [];
  while (Date.now() < deadline) {
    const current = await readStoreyLabelGeometry(page);
    const stable =
      current.length > 0 &&
      current.length === previous.length &&
      current.every((entry, i) => {
        const before = previous[i];
        return before !== undefined && Math.abs(entry.clearancePx - before.clearancePx) < 0.5;
      });
    if (stable) {
      return current;
    }
    previous = current;
    await page.waitForTimeout(200);
  }
  throw new Error("storey labels never settled within 20s");
}

for (const viewport of CLEARANCE_VIEWPORTS) {
  test(`storey labels clear the panel at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await stubDollhouse(page);
    await openHeroAt(page, "exploded");
    await expect(page.locator(".arrival-storey-label").first()).toBeVisible({ timeout: 15_000 });

    const geometry = await settledStoreyLabelGeometry(page);
    for (const entry of geometry) {
      // The direct measurement first, so a regression names the element that
      // took the hit point — "COVERED-BY:span.fr-w" in the reproduction
      // recorded above — rather than reading as an anonymous number.
      expect(entry.topmost).toBe("SELF");
      expect(entry.clearancePx).toBeGreaterThan(STOREY_LABEL_CLEARANCE_MIN_PX);
    }
  });
}

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
