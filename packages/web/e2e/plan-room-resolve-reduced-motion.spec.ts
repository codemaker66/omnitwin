import { test, expect, type Page } from "@playwright/test";
import {
  API,
  receptionRuntimePackage,
  stubPlannerBootstrap,
} from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// Reduced-motion resolve, in its own file deliberately: fifth-in-sequence on a
// churned worker this case cannot even boot the planner (GPU e2e law: serial
// AND per-file invocations). In isolation it passes in ~40s.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

async function readPhase(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.querySelector("[data-resolve-phase]")?.getAttribute("data-resolve-phase") ?? "absent",
  );
}

async function readCaptionVisible(page: Page): Promise<string> {
  return page.evaluate(() => {
    const captions = document.querySelectorAll('[data-testid="room-resolve-caption"]');
    const last = captions[captions.length - 1];
    return last?.getAttribute("data-visible") ?? "absent";
  });
}

test.describe("CARD A2 reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reduced motion: the resolve still completes as a crossfade, no develop choreography required", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    page.on("pageerror", (error) => { console.log(`[rm-pageerror] ${error.message.slice(0, 300)}`); });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[rm-console] ${message.text().slice(0, 200)}`);
    });
    const origin = baseURL ?? "http://localhost:5173";
    await page.emulateMedia({ reducedMotion: "reduce" });

    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: receptionRuntimePackage(origin) } });
    });

    await page.goto("/plan?capture=1");

    await expect
      .poll(() => readPhase(page), { timeout: 20_000, message: "waiting for developing" })
      .toBe("developing");
    await expect(page.getByTestId("room-resolve-caption").last()).toBeVisible();
    await expect
      .poll(async () => `${await readPhase(page)}|${await readCaptionVisible(page)}`, { timeout: 180_000 })
      .toBe("resolved|false");
  });
});
