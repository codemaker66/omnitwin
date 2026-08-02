import { expect, test, type Page } from "@playwright/test";
import {
  CANONICAL_ASSETS,
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type CanonicalLayoutSnapshotV0,
} from "@omnitwin/types";

const API = "http://localhost:3001";
const CONFIG_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.configurationId;
const VENUE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueId;
const SPACE_ID = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.spaceId;
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_EVENT_ID = "15151515-1515-4515-8515-151515151515";
const LEADING_ID = "13131313-1313-4313-8313-131313131313";
const ARRIVAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVALID_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DINNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOM_FLIP_ID = "16161616-1616-4616-8616-161616161616";
const TRAILING_ID = "14141414-1414-4414-8414-141414141414";
const ANCHOR_DATE = "2026-07-18";
const DISCLOSURE = "Planning scenario estimate; not a quote or approval.";
// Match the repository's established headless frame-budget sampling window.
const FRAME_BUDGET_SAMPLE_MS = 1_200;
const FRAME_BUDGET_P95_MS = 18.5;
const MAX_SUSTAINED_FRAME_BUDGET_MISSES = 1;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1536, height: 960 } });

interface TimelineHarness {
  readonly requests: Array<{ scope: string; anchorDate: string }>;
  readonly delayNextTimelineResponse: () => () => void;
}

interface FrameBudgetSummary {
  readonly sampleCount: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly sustainedMisses: number;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function longestRunAbove(values: readonly number[], threshold: number): number {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    if (value > threshold) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function frameBudgetSummary(samples: readonly number[]): FrameBudgetSummary {
  return {
    sampleCount: samples.length,
    p95Ms: percentile(samples, 95),
    maximumMs: samples.length === 0 ? 0 : Math.max(...samples),
    sustainedMisses: longestRunAbove(samples, FRAME_BUDGET_P95_MS),
  };
}

async function sampleAnimationFrames(page: Page, durationMs: number): Promise<readonly number[]> {
  return page.evaluate((sampleDurationMs) => new Promise<readonly number[]>((resolve) => {
    const deltas: number[] = [];
    let previous = performance.now();
    const endsAt = previous + sampleDurationMs;
    const tick = (now: number): void => {
      deltas.push(now - previous);
      previous = now;
      if (now >= endsAt) {
        resolve(deltas.slice(1));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), durationMs);
}

function asset(slug: string) {
  const found = CANONICAL_ASSETS.find((candidate) => candidate.slug === slug);
  if (found === undefined) throw new Error(`Missing canonical asset ${slug}`);
  return found;
}

const CHAIR = asset("banquet-chair");

function snapshot(objectCount: number, arrangement: 0 | 1 | 2, guests: number): CanonicalLayoutSnapshotV0 {
  const rowCount = Math.max(1, Math.ceil(objectCount / 25));
  const objects = Array.from({ length: objectCount }, (_, index) => {
    const column = index % 25;
    const row = Math.floor(index / 25);
    const columnFactor = arrangement === 1 ? 7 : 13;
    const rowFactor = arrangement === 1 ? 3 : 7;
    const arrangedColumn = arrangement === 0 ? column : (column * columnFactor) % 25;
    const arrangedRow = arrangement === 0 ? row : (row * rowFactor) % rowCount;
    return {
      objectId: `90000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      assetDefinition: {
        assetDefinitionId: CHAIR.id,
        category: CHAIR.category,
        widthM: CHAIR.widthM,
        depthM: CHAIR.depthM,
        heightM: CHAIR.heightM,
        seatCount: CHAIR.seatCount,
        collisionType: CHAIR.collisionType,
      },
      position: {
        x: 0.55 + arrangedColumn * 0.79,
        y: 0,
        z: 0.55 + arrangedRow * 0.47,
      },
      rotation: {
        x: 0,
        y: (index % 8) * (Math.PI / 4)
          + arrangement * ((index % 5) - 2) * (Math.PI / 18),
        z: 0,
      },
      scale: 1,
      sortOrder: index,
      groupId: null,
      metadata: null,
    };
  });
  return {
    ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
    guestCount: guests,
    eventMetadata: { ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.eventMetadata, guestCount: guests },
    objects,
  };
}

function figures(guests: number, capacity: number, revenueMinor: number) {
  return {
    guests: { value: guests, source: "frozen_snapshot" },
    seatedCapacity: {
      state: "available",
      value: capacity,
      source: "frozen_snapshot",
      basis: "chair_objects",
    },
    staffing: {
      state: "not_checked",
      value: null,
      source: "phase_staff_conflicts",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
    },
    revenue: {
      state: "available",
      source: "planning_scenario",
      scenario: {
        id: "34343434-3434-4434-8434-343434343434",
        name: "Wedding planning scenario",
        status: "active",
        scenarioKind: "layout_based",
        currency: "GBP",
        plannedGuestCount: guests,
        estimatedRevenueMinor: revenueMinor,
        comfortStatus: "not_checked",
        reviewGateCount: 0,
        updatedAt: "2026-07-17T10:00:00.000Z",
      },
      disclosure: DISCLOSURE,
    },
  } as const;
}

function unavailableFigures(guests: number) {
  return {
    guests: { value: guests, source: "phase" },
    seatedCapacity: { state: "unavailable", reason: "no_valid_frozen_keyframe" },
    staffing: {
      state: "not_checked",
      value: null,
      source: "phase_staff_conflicts",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
    },
    revenue: { state: "unavailable", reason: "no_valid_frozen_keyframe" },
  } as const;
}

function baseFrame(id: string, phaseName: string, startsAt: string, endsAt: string) {
  return {
    id,
    kind: "phase",
    eventId: EVENT_ID,
    eventName: "Elaine & James",
    eventType: "wedding",
    eventStatus: "in_planning",
    eventGuestCount: 180,
    phaseId: id,
    phaseName,
    templateKey: null,
    sortOrder: 0,
    startsAt,
    endsAt,
    guestCount: 180,
    opsTasksCount: 0,
    reviewGatesCount: 0,
    densityStatus: "not_checked",
    densityLabel: "Density not checked",
    staffConflictsStatus: "not_checked",
    staffConflictsLabel: "Staff conflicts not checked",
  } as const;
}

function availableFrame(
  id: string,
  phaseName: string,
  startsAt: string,
  endsAt: string,
  payload: CanonicalLayoutSnapshotV0,
  snapshotId: string,
  revenueMinor: number,
) {
  return {
    ...baseFrame(id, phaseName, startsAt, endsAt),
    figures: figures(payload.guestCount, payload.objects.length, revenueMinor),
    keyframe: {
      state: "available",
      snapshotId,
      snapshotStatus: "frozen",
      canonicalSnapshotId: "89898989-8989-4989-8989-898989898989",
      proofDigest: "b".repeat(64),
      frozenBy: "67676767-6767-4767-8767-676767676767",
      supersedesSnapshotId: null,
      createdAt: "2026-07-17T10:00:00.000Z",
      frozenAt: "2026-07-17T10:05:00.000Z",
      objectCount: payload.objects.length,
      guestCount: payload.guestCount,
      payload,
    },
  } as const;
}

function timelineFrames(objectCount: number) {
  const arrival = snapshot(objectCount, 0, 160);
  const dinner = snapshot(objectCount, 1, 180);
  const party = snapshot(objectCount, 2, 200);
  return [
    {
      ...baseFrame(LEADING_ID, "Early setup", "2026-07-18T14:00:00.000Z", "2026-07-18T15:30:00.000Z"),
      figures: unavailableFigures(180),
      keyframe: { state: "missing", reason: "no_snapshot", message: "No frozen early setup layout." },
    },
    availableFrame(ARRIVAL_ID, "Guest arrival", "2026-07-18T16:00:00.000Z", "2026-07-18T17:30:00.000Z", arrival, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 2_575_000),
    {
      ...baseFrame(INVALID_ID, "Speeches", "2026-07-18T17:00:00.000Z", "2026-07-18T19:30:00.000Z"),
      figures: unavailableFigures(180),
      keyframe: {
        state: "invalid",
        snapshotId: "abababab-abab-4bab-8bab-abababababab",
        snapshotStatus: "frozen",
        createdAt: "2026-07-17T10:00:00.000Z",
        frozenAt: "2026-07-17T10:05:00.000Z",
        reason: "payload_schema_invalid",
        message: "The speeches layout is invalid.",
      },
    },
    availableFrame(DINNER_ID, "Dinner service", "2026-07-18T20:00:00.000Z", "2026-07-18T21:30:00.000Z", dinner, "ffffffff-ffff-4fff-8fff-ffffffffffff", 2_875_000),
    {
      ...baseFrame(ROOM_FLIP_ID, "Room flip", "2026-07-18T21:30:00.000Z", "2026-07-18T22:00:00.000Z"),
      kind: "room_flip",
      templateKey: "room-flip",
      figures: unavailableFigures(180),
      keyframe: {
        state: "missing",
        reason: "room_flip_gap",
        message: "Operational room flip between events.",
      },
    },
    {
      ...availableFrame(PARTY_ID, "Evening party", "2026-07-18T22:00:00.000Z", "2026-07-18T23:30:00.000Z", party, "12121212-1212-4212-8212-121212121212", 3_175_000),
      eventId: SECOND_EVENT_ID,
      eventName: "Charity Gala",
      eventType: "gala",
    },
    {
      ...baseFrame(TRAILING_ID, "Late breakdown", "2026-07-19T00:00:00.000Z", "2026-07-19T01:30:00.000Z"),
      eventId: SECOND_EVENT_ID,
      eventName: "Charity Gala",
      eventType: "gala",
      figures: unavailableFigures(180),
      keyframe: { state: "missing", reason: "no_snapshot", message: "No frozen late breakdown layout." },
    },
  ];
}

function rangeFor(scope: string, anchorDate: string) {
  if (scope === "week") {
    return {
      scope: "week",
      anchorDate,
      from: "2026-07-12T23:00:00.000Z",
      to: "2026-07-19T23:00:00.000Z",
    } as const;
  }
  return {
    scope: "day",
    anchorDate,
    from: "2026-07-18T03:00:00.000Z",
    to: "2026-07-19T03:00:00.000Z",
  } as const;
}

async function stubTimelinePlanner(page: Page, objectCount = 24): Promise<TimelineHarness> {
  const venue = {
    id: VENUE_ID,
    name: "Trades Hall",
    slug: "trades-hall-glasgow",
    address: "85 Glassford Street",
    logoUrl: null,
    brandColour: null,
  };
  const space = {
    id: SPACE_ID,
    venueId: VENUE_ID,
    // Deliberately differs from every frozen venueRuntime payload. Browser
    // assertions below prove the preview does not borrow this live outline.
    name: "Current Drift Room",
    slug: "current-drift-room",
    widthM: "8",
    lengthM: "6",
    heightM: "3",
    floorPlanOutline: [{ x: 100, y: 200 }, { x: 108, y: 200 }, { x: 108, y: 206 }, { x: 100, y: 206 }],
  };
  const configuration = {
    id: CONFIG_ID,
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    userId: null,
    name: "Timeline QA layout",
    isPublicPreview: true,
    revision: 1,
    objects: [{
      id: "e2e-timeline-live-object",
      configurationId: CONFIG_ID,
      assetDefinitionId: CHAIR.id,
      positionX: "1",
      positionY: "0",
      positionZ: "1",
      rotationX: "0",
      rotationY: "0",
      rotationZ: "0",
      scale: "1",
      sortOrder: 0,
      metadata: null,
    }],
  };
  const requests: TimelineHarness["requests"] = [];
  let nextTimelineResponseGate: Promise<void> | null = null;
  let releaseNextTimelineResponse: (() => void) | null = null;

  await page.route(`${API}/venues`, (route) => { void route.fulfill({ json: { data: [venue] } }); });
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => { void route.fulfill({ json: { data: [space] } }); });
  await page.route(`${API}/public/configurations`, (route) => { void route.fulfill({ json: { data: configuration } }); });
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => { void route.fulfill({ json: { data: configuration } }); });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => { void route.fulfill({ json: { data: space } }); });
  await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
    void route.fulfill({ json: { data: null } });
  });
  await page.route(`${API}/truth-mode/summary*`, (route) => {
    void route.fulfill({ json: { data: {
      targetType: "configuration",
      targetId: CONFIG_ID,
      source: "Planning context - not a measured source of record",
      confidence: "unknown",
      assumption: "Human review required before reliance",
      evidenceStatus: "not_checked",
      reviewGate: "Human review required",
      staleState: "unknown",
      safeWording: ["Planning evidence - human review required before operational reliance."],
      humanReviewRequired: true,
      counts: { evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 },
    } } });
  });
  await page.route(`${API}/calendar/layout-timeline*`, (route) => {
    const fulfill = async (): Promise<void> => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get("scope") === "week" ? "week" : "day";
    const anchorDate = url.searchParams.get("anchorDate") ?? ANCHOR_DATE;
    requests.push({ scope, anchorDate });
    const range = rangeFor(scope, anchorDate);
    const gate = nextTimelineResponseGate;
    nextTimelineResponseGate = null;
    if (gate !== null) await gate;
    void route.fulfill({ json: { data: {
      venueId: VENUE_ID,
      spaceId: SPACE_ID,
      timeZone: "Europe/London",
      from: range.from,
      to: range.to,
      range,
      frames: timelineFrames(objectCount).filter((frame) =>
        objectCount < 500 || frame.id !== INVALID_ID,
      ),
    } } });
    };
    void fulfill();
  });
  return {
    requests,
    delayNextTimelineResponse: () => {
      if (nextTimelineResponseGate !== null) {
        throw new Error("A delayed timeline response is already armed");
      }
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      nextTimelineResponseGate = gate;
      releaseNextTimelineResponse = () => {
        if (nextTimelineResponseGate === gate) nextTimelineResponseGate = null;
        release?.();
      };
      return () => {
        releaseNextTimelineResponse?.();
        releaseNextTimelineResponse = null;
      };
    },
  };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(`pageerror: ${error.message}`); });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function scrubTo(page: Page, iso: string): Promise<void> {
  await page.getByRole("slider", { name: "Scrub room layout timeline" })
    .fill(String(Date.parse(iso)));
}

function filmstripCard(page: Page, phaseName: string) {
  return page.locator(".layout-filmstrip__card").filter({ hasText: phaseName });
}

async function filmstripContainsCard(page: Page, phaseName: string): Promise<boolean> {
  const [cardBox, stripBox] = await Promise.all([
    filmstripCard(page, phaseName).boundingBox(),
    page.locator(".layout-filmstrip").boundingBox(),
  ]);
  if (cardBox === null || stripBox === null) return false;
  return cardBox.x >= stripBox.x - 1
    && cardBox.x + cardBox.width <= stripBox.x + stripBox.width + 1;
}

async function expectMultipleEventsAndRoomFlip(page: Page): Promise<void> {
  await expect(filmstripCard(page, "Guest arrival"))
    .toHaveAttribute("aria-label", /Elaine & James.*Guest arrival.*Frozen layout/u);
  await expect(filmstripCard(page, "Evening party"))
    .toHaveAttribute("aria-label", /Charity Gala.*Evening party.*Frozen layout/u);
  await expect(filmstripCard(page, "Room flip"))
    .toHaveAttribute("aria-label", /Room flip.*Room flip gap/u);
}

test("Day/Week timeline clicks, scrubs, shortcuts, retargets, and keeps gaps truthful", async ({ page }) => {
  const errors = collectErrors(page);
  const harness = await stubTimelinePlanner(page);
  await page.goto(`/plan/${CONFIG_ID}?timelineScope=day&timelineDate=${ANCHOR_DATE}`);
  await expect(page.getByRole("slider", { name: "Scrub room layout timeline" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Guests: 160")).toBeVisible();
  await expect(page.getByLabel("Staffing: Not recorded")).toBeVisible();
  await expectMultipleEventsAndRoomFlip(page);
  const sceneHost = page.locator(".planner-scene-canvas-host");
  await expect(sceneHost).toHaveAttribute("data-room-authority", "frozen");
  await expect(sceneHost).toHaveAttribute("data-room-render-dimensions", "42,21,7");
  await expect(sceneHost).toHaveAttribute("data-room-furniture-offset", "-21,0,-10.5");
  await expect(sceneHost).toHaveAttribute("data-current-splat-suppressed", "true");
  await expect(page.getByTestId("cockpit-runtime-chip"))
    .toContainText("Frozen outline · historical capture unavailable");

  await scrubTo(page, "2026-07-18T13:30:00.000Z");
  const scheduleGapSlider = page.getByRole("slider", { name: "Scrub room layout timeline" });
  await expect(scheduleGapSlider).toHaveAttribute(
    "aria-valuetext",
    /14:30 · Schedule gap before Early setup/u,
  );
  await expect(page.locator('.layout-filmstrip__card[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByLabel("Guests: —")).toBeVisible();
  await expect(page.getByLabel("Seated capacity: Unavailable")).toBeVisible();
  await expect(page.getByLabel("Staffing: —")).toBeVisible();
  await expect(page.getByLabel("Revenue: Unavailable")).toBeVisible();
  await expect(page.getByTestId("layout-timeline-preview-caption"))
    .toContainText("Schedule gap · No room phase is scheduled yet. · no room shell or saved layout shown");
  await expect(page.getByTestId("cockpit-topbar")).toContainText("No scheduled phase");
  await expect(page.getByTestId("cockpit-minimap-unavailable"))
    .toHaveText("No room preview available");
  await expect(page.locator(".cockpit-minimap__preview-canvas")).toHaveCount(0);
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("timelinePhaseId")).toBeNull();

  await page.getByRole("button", { name: "Collapse room timeline" }).click();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "inactive");
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "false");
  await page.getByRole("button", { name: "Expand room timeline" }).click();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "schedule-gap");
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "true");
  await expect(page.getByTestId("layout-timeline-preview-caption"))
    .toContainText("Schedule gap · No room phase is scheduled yet. · no room shell or saved layout shown");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGapCaption = page.getByTestId("layout-timeline-preview-caption");
  await expect(mobileGapCaption).toBeVisible();
  const mobileGapCaptionBox = await mobileGapCaption.boundingBox();
  const mobileGapDockBox = await page.getByTestId("cockpit-bottom").boundingBox();
  expect(mobileGapCaptionBox).not.toBeNull();
  expect(mobileGapDockBox).not.toBeNull();
  expect((mobileGapCaptionBox?.y ?? 0) + (mobileGapCaptionBox?.height ?? 0))
    .toBeLessThanOrEqual((mobileGapDockBox?.y ?? 0) + 1);
  const visibleRulerTickBoxes = await page.locator(".layout-ruler__tick").evaluateAll((nodes) => (
    nodes.flatMap((node) => {
      if (getComputedStyle(node).display === "none") return [];
      const box = node.getBoundingClientRect();
      return [{ left: box.left, right: box.right }];
    })
  ));
  for (let index = 1; index < visibleRulerTickBoxes.length; index += 1) {
    expect(visibleRulerTickBoxes[index]?.left ?? 0)
      .toBeGreaterThanOrEqual((visibleRulerTickBoxes[index - 1]?.right ?? 0) - 1);
  }
  await expect(page.locator(".layout-ruler__tick").filter({ hasText: "02:30" })).toBeVisible();
  await page.setViewportSize({ width: 1536, height: 960 });

  await page.getByRole("button", { name: "Next saved layout" }).click();
  await expect(filmstripCard(page, "Guest arrival")).toHaveAttribute("aria-pressed", "true");

  await scrubTo(page, "2026-07-18T21:45:00.000Z");
  const roomFlipSlider = page.getByRole("slider", { name: "Scrub room layout timeline" });
  await expect(roomFlipSlider).toHaveAttribute(
    "aria-valuetext",
    /22:45 · Elaine & James · Room flip · Room flip gap/u,
  );
  await expect(filmstripCard(page, "Evening party")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Guests: 200")).toBeVisible();
  await expect(page.getByTestId("layout-timeline-preview-caption"))
    .toContainText("Visualizing phase change");

  await filmstripCard(page, "Dinner service").click();
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Guests: 180")).toBeVisible();
  await expect(page.locator('.layout-metric[aria-label="Guests: 180"] .layout-metric__value'))
    .toHaveCSS("animation-name", "layout-number-tumble");
  await expect(page.getByText("Elaine & James → Dinner service", { exact: true })).toBeVisible();
  await filmstripCard(page, "Evening party").click();
  await expect(page.getByText("Charity Gala → Evening party", { exact: true })).toBeVisible();
  await filmstripCard(page, "Guest arrival").click();
  await filmstripCard(page, "Evening party").click();
  await expect(filmstripCard(page, "Evening party")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Guests: 200")).toBeVisible();

  await scrubTo(page, "2026-07-18T14:30:00.000Z");
  await expect(filmstripCard(page, "Early setup")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("layout-timeline-preview-caption")).toContainText("No frozen early setup layout");
  await scrubTo(page, "2026-07-18T17:15:00.000Z");
  await expect(page.getByRole("slider", { name: "Scrub room layout timeline" }))
    .toHaveAttribute("aria-valuetext", /18:15 · Elaine & James · Speeches · Saved layout invalid/u);
  await expect(filmstripCard(page, "Speeches")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Guests: 180")).toBeVisible();
  await expect(page.getByTestId("layout-timeline-preview-caption")).toContainText("speeches layout is invalid");
  await expect(page.getByTestId("cockpit-minimap-unavailable"))
    .toHaveText("No room preview available");
  await expect(page.locator(".cockpit-minimap__preview-canvas")).toHaveCount(0);
  await scrubTo(page, "2026-07-19T00:30:00.000Z");
  await expect(filmstripCard(page, "Late breakdown")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("layout-timeline-preview-caption")).toContainText("No frozen late breakdown layout");
  await scrubTo(page, "2026-07-19T01:30:00.000Z");
  await expect(page.getByRole("slider", { name: "Scrub room layout timeline" }))
    .toHaveAttribute("aria-valuetext", /02:30 · Schedule gap after Late breakdown/u);
  await expect(page.locator('.layout-filmstrip__card[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByLabel("Guests: —")).toBeVisible();
  await expect(page.getByTestId("cockpit-minimap-unavailable"))
    .toHaveText("No room preview available");
  await expect(page.locator(".cockpit-minimap__preview-canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous saved layout" }).click();
  await expect(filmstripCard(page, "Evening party")).toHaveAttribute("aria-pressed", "true");

  await filmstripCard(page, "Guest arrival").click();
  await expect(filmstripCard(page, "Guest arrival")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".cockpit-stage").click({ position: { x: 30, y: 30 } });
  await page.keyboard.press("]");
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("[");
  await expect(filmstripCard(page, "Guest arrival")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play full timeline" })).toBeVisible();

  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => harness.requests.some((request) =>
    request.scope === "week" && request.anchorDate === ANCHOR_DATE,
  )).toBe(true);
  await expect(page.getByText("Week of Mon, 13 Jul 2026", { exact: true })).toBeVisible();
  await expectMultipleEventsAndRoomFlip(page);
  expect(errors).toEqual([]);
});

test("deep links survive reload/back-forward, reduced motion, and required responsive widths", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const harness = await stubTimelinePlanner(page);
  const invalidUrl = `/plan/${CONFIG_ID}?timelineScope=day&timelineDate=${ANCHOR_DATE}&timelinePhaseId=${INVALID_ID}`;
  const dinnerUrl = `/plan/${CONFIG_ID}?timelineScope=week&timelineDate=${ANCHOR_DATE}&timelinePhaseId=${DINNER_ID}`;
  await page.goto(invalidUrl);
  await expect(filmstripCard(page, "Speeches")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("timelinePhaseId")).toBe(INVALID_ID);
  await page.reload();
  await expect(filmstripCard(page, "Speeches")).toHaveAttribute("aria-pressed", "true");
  await page.goto(dinnerUrl);
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(filmstripCard(page, "Speeches")).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator(".layout-filmstrip").evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await expect.poll(() => filmstripContainsCard(page, "Dinner service")).toBe(true);
  await page.setViewportSize({ width: 1536, height: 960 });

  await filmstripCard(page, "Evening party").click();
  await expect(filmstripCard(page, "Evening party")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".layout-metric__value").first()).toHaveCSS("animation-name", "none");

  const requestCountBeforeResize = harness.requests.length;
  const releaseDelayedResponse = harness.delayNextTimelineResponse();
  try {
    for (const viewport of [
      { width: 1536, height: 960 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("cockpit-bottom")).toBeVisible();
      await expect(page.getByTestId("planner-3d-shell"))
        .toHaveAttribute("data-layout-timeline-preview", "keyframe");
      await expect(page.getByTestId("planner-3d-shell"))
        .toHaveAttribute("data-layout-timeline-preview-phase-id", PARTY_ID);
      await expect(page.getByTestId("planner-3d-shell"))
        .toHaveAttribute("data-layout-timeline-preview-object-count", "24");
      await expect(page.getByTestId("planner-3d-shell"))
        .toHaveAttribute("data-layout-timeline-mutation-locked", "true");
      await expect(page.getByRole("button", { name: "2D", exact: true })).toBeDisabled();
      await expect(filmstripCard(page, "Evening party")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Guests: 200")).toBeVisible();
      for (const label of ["Guests", "Seated capacity", "Staffing", "Revenue"]) {
        await expect(page.locator(`.layout-metric[aria-label^="${label}:"]`)).toBeVisible();
      }
      if (viewport.width <= 640) {
        const mobileSend = page.getByRole("button", { name: "Send to Events Team" });
        await expect(mobileSend).toBeVisible();
        await expect(mobileSend).toBeDisabled();
        await expect(mobileSend).toHaveText("Exit preview");
        const caption = page.getByTestId("layout-timeline-preview-caption");
        await expect(caption).toBeVisible();
        const captionBox = await caption.boundingBox();
        const mobileDockBox = await page.getByTestId("cockpit-bottom").boundingBox();
        expect(captionBox).not.toBeNull();
        expect(mobileDockBox).not.toBeNull();
        expect((captionBox?.y ?? 0) + (captionBox?.height ?? 0))
          .toBeLessThanOrEqual((mobileDockBox?.y ?? 0) + 1);
        expect(mobileDockBox?.height ?? 0).toBeCloseTo(386, 0);

        const metricContainerBox = await page.locator(".layout-timeline__metrics").boundingBox();
        const primaryMetricBoxes = await page.locator(".layout-metric:not(.is-secondary)")
          .evaluateAll((nodes) => nodes.map((node) => {
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          }));
        expect(metricContainerBox).not.toBeNull();
        expect(primaryMetricBoxes).toHaveLength(4);
        for (const metricBox of primaryMetricBoxes) {
          expect(metricBox.left).toBeGreaterThanOrEqual((metricContainerBox?.x ?? 0) - 1);
          expect(metricBox.right).toBeLessThanOrEqual(
            (metricContainerBox?.x ?? 0) + (metricContainerBox?.width ?? 0) + 1,
          );
        }

        const activeCardBox = await filmstripCard(page, "Evening party").boundingBox();
        const filmstripBox = await page.locator(".layout-filmstrip").boundingBox();
        expect(activeCardBox).not.toBeNull();
        expect(filmstripBox).not.toBeNull();
        expect(activeCardBox?.x ?? 0).toBeGreaterThanOrEqual((filmstripBox?.x ?? 0) - 1);
        expect((activeCardBox?.x ?? 0) + (activeCardBox?.width ?? 0)).toBeLessThanOrEqual(
          (filmstripBox?.x ?? 0) + (filmstripBox?.width ?? 0) + 1,
        );

        await expect(page.locator(".layout-phase.is-micro").first()).toHaveCSS("overflow", "hidden");
      }
      const dockBox = await page.getByTestId("cockpit-bottom").boundingBox();
      expect(dockBox).not.toBeNull();
      expect((dockBox?.x ?? 0) + (dockBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
      expect(harness.requests).toHaveLength(requestCountBeforeResize);
    }
  } finally {
    releaseDelayedResponse();
  }

  await page.getByRole("button", { name: "Collapse room timeline" }).click();
  await expect(page.getByRole("button", { name: "Expand room timeline" })).toBeVisible();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "inactive");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Expand room timeline" })).toBeVisible();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "inactive");
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "false");

  await page.getByRole("button", { name: "Expand room timeline" }).click();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "keyframe");
  await page.locator(".layout-exit-preview").click();
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "inactive");
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "false");
  await expect(page.getByRole("button", { name: "Send to Events Team" })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-preview", "inactive");
  await expect(page.getByTestId("planner-3d-shell"))
    .toHaveAttribute("data-layout-timeline-mutation-locked", "false");
  await expect(page.getByRole("button", { name: "2D", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("500-object keyframes remain responsive and within the 60fps frame budget", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await stubTimelinePlanner(page, 500);
  await page.goto(`/plan/${CONFIG_ID}?timelineScope=day&timelineDate=${ANCHOR_DATE}`);
  await expect(page.getByText("500 phase preview items")).toBeVisible({ timeout: 20_000 });

  const canvasHost = page.locator(".cockpit-stage .planner-scene-canvas-host");
  await expect(canvasHost, "the frozen scene must finish its first real canvas render before idle sampling")
    .toHaveAttribute("data-timeline-preview-render-ready", "true", { timeout: 20_000 });

  const idleFrameBudget = frameBudgetSummary(
    await sampleAnimationFrames(page, FRAME_BUDGET_SAMPLE_MS),
  );

  const canvas = page.locator(".cockpit-stage .planner-scene-canvas-host canvas");
  await expect(canvas).toHaveCount(1);
  const beforeMorph = await canvas.screenshot();
  await filmstripCard(page, "Dinner service").click();
  await page.waitForTimeout(220);
  const duringMorph = await canvas.screenshot();
  expect(duringMorph.equals(beforeMorph), "500-object canvas must visibly advance during the morph")
    .toBe(false);
  await testInfo.attach("500-object-before-morph.png", {
    body: beforeMorph,
    contentType: "image/png",
  });
  await testInfo.attach("500-object-during-morph.png", {
    body: duringMorph,
    contentType: "image/png",
  });
  await page.waitForTimeout(600);
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true");
  const settledMorph = await canvas.screenshot();
  expect(settledMorph.equals(beforeMorph), "500-object endpoints must render distinct layouts")
    .toBe(false);
  expect(duringMorph.equals(settledMorph), "500-object intermediate frame must not be an immediate endpoint swap")
    .toBe(false);
  await testInfo.attach("500-object-settled-morph.png", {
    body: settledMorph,
    contentType: "image/png",
  });
  await filmstripCard(page, "Guest arrival").click();
  await page.waitForTimeout(750);
  await expect(filmstripCard(page, "Guest arrival")).toHaveAttribute("aria-pressed", "true");

  const startedAt = await page.evaluate(() => performance.now());
  const [frameSamples] = await Promise.all([
    sampleAnimationFrames(page, FRAME_BUDGET_SAMPLE_MS),
    filmstripCard(page, "Dinner service").click(),
  ]);
  await expect(filmstripCard(page, "Dinner service")).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  const elapsedMs = await page.evaluate((started) => performance.now() - started, startedAt);
  const frameBudget = frameBudgetSummary(frameSamples);
  await testInfo.attach("500-object-frame-budget.json", {
    body: JSON.stringify({ idle: idleFrameBudget, morph: frameBudget }, null, 2),
    contentType: "application/json",
  });
  expect(elapsedMs).toBeLessThan(4_000);
  const frameBudgetEvidence = JSON.stringify({ idle: idleFrameBudget, morph: frameBudget });
  expect(idleFrameBudget.sampleCount, frameBudgetEvidence).toBeGreaterThanOrEqual(60);
  expect(idleFrameBudget.p95Ms, frameBudgetEvidence).toBeLessThanOrEqual(FRAME_BUDGET_P95_MS);
  expect(idleFrameBudget.sustainedMisses, frameBudgetEvidence)
    .toBeLessThanOrEqual(MAX_SUSTAINED_FRAME_BUDGET_MISSES);
  expect(frameBudget.sampleCount, frameBudgetEvidence).toBeGreaterThanOrEqual(60);
  expect(frameBudget.p95Ms, frameBudgetEvidence).toBeLessThanOrEqual(FRAME_BUDGET_P95_MS);
  expect(frameBudget.sustainedMisses, frameBudgetEvidence)
    .toBeLessThanOrEqual(MAX_SUSTAINED_FRAME_BUDGET_MISSES);
  await expect(page.getByText("500 phase preview items")).toBeVisible();
  expect(errors).toEqual([]);
});
