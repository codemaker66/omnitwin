// TEMPORARY PROBE (T-742), copied into e2e/ only inside the probe job: the Escape case's opening with the page's main thread held for 12 s
// just after the Assembly's code has run, as a slow runner's first build of the hall holds it.
import { expect, test } from "@playwright/test";
import { API, CONFIG_ID, GRAND_HALL_SPACE, PLAN_CONFIG, VENUE, stubPlannerBootstrap } from "./support/plan-bootstrap.js";
import { grandHallDinner180 } from "../src/floor/assembly/fixture.js";

const SEATED = new Set(["ga-group-01", "ga-group-02", "ga-group-03"]);
const OBJECTS = grandHallDinner180()
  .filter((item) => item.groupId !== null && SEATED.has(item.groupId))
  .map((item, index) => ({
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    configurationId: CONFIG_ID,
    assetDefinitionId: item.catalogueItemId,
    positionX: item.x.toFixed(3),
    positionY: item.y.toFixed(3),
    positionZ: item.z.toFixed(3),
    rotationX: "0",
    rotationY: item.rotationY.toFixed(6),
    rotationZ: "0",
    scale: "1",
    sortOrder: index,
    metadata: { groupId: item.groupId },
  }));

test.setTimeout(150_000);

test("the Skip comes though the first build holds the page for 12 s after the Assembly's code is in", async ({ page }) => {
  await page.addInitScript(() => {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.includes("/floor/assembly/GrandAssembly.tsx")) continue;
        void import(/* @vite-ignore */ entry.name).then(() => {
          window.setTimeout(() => {
            const until = performance.now() + 12_000;
            while (performance.now() < until) { /* held, as a long first build holds it */ }
          }, 150);
        });
      }
    }).observe({ type: "resource", buffered: true });
  });
  await stubPlannerBootstrap(page);
  await page.route(`${API}/public/configurations/${CONFIG_ID}**`, (route) => {
    void route.fulfill({ json: { data: { ...PLAN_CONFIG, spaceId: GRAND_HALL_SPACE.id, name: "Dinner for 30", objects: OBJECTS } } });
  });
  await page.route(`${API}/venues/${VENUE.id}/spaces/${GRAND_HALL_SPACE.id}`, (route) => {
    void route.fulfill({ json: { data: GRAND_HALL_SPACE } });
  });
  await page.route(`${API}/venues/${VENUE.id}`, (route) => {
    void route.fulfill({ json: { data: { ...VENUE, spaces: [GRAND_HALL_SPACE] } } });
  });
  await page.goto(`/plan/${CONFIG_ID}?assembly=accio`);
  await expect(page.locator(".assembly-replay")).toHaveAttribute("data-playing", "true", { timeout: 60_000 });
});
