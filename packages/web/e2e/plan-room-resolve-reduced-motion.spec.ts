import { expect } from "@playwright/test";
import { captureLaunchOptions } from "./support/capture-launch.js";
import {
  stubPlannerBootstrap,
} from "./support/plan-bootstrap.js";
import { attachStageEvidence, recordStageTimeline, stageMilestone } from "./support/stage-timeline.js";
import { test } from "./support/staged-reception.js";

// A failing first attempt keeps its trace, without screenshots (as plan-room-resolve.spec.ts says why).
test.use({ launchOptions: captureLaunchOptions, trace: { mode: "retain-on-first-failure", screenshots: false } });

// ---------------------------------------------------------------------------
// Reduced-motion resolve, in its own file (GPU e2e law: serial AND per-file
// invocations). Its launch options are worker-scoped, so this file always
// starts on a fresh worker and browser; worker churn is not what it meets.
//
// What it met on CI (11-12 Nov 2026, two retried failures in 198 runs) is not
// reproduced, and its cause is a hypothesis. Both failing first attempts were
// whole-page slowdowns: the navigation took 6-10 s against about 0.5 s
// normally, and the planner had only just mounted ("Opening the 3D view…", "0
// of 5 chunks") when the 20 s window closed. The case is the shard's first
// navigation of the Vite app, so the dev server's cold start is the leading
// hypothesis. It is unproven: locally, on a cold server, the warmup below moved
// developing by about 150 ms (1 677 to 1 525 ms); a cold server under 6x CPU
// throttling still passed; and the on-demand transforms took well under a
// second in all, not the 20 s the failures lost. The dev server now prepares the
// planner's lazily imported modules at start (vite.config.ts server.warmup:
// the first planner navigation measured 30 on-demand transforms before, 7
// after). Both windows run on the page's clock from the navigation's start, and
// a failure prints what the page and the Playwright worker were waiting on
// (support/stage-timeline.ts).
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "default" });

/** The develop must begin this soon after the navigation starts. */
const DEVELOPING_WITHIN_MS = 20_000;
/** And the room must settle this soon after it began to develop. */
const SETTLED_AFTER_DEVELOPING_MS = 180_000;

test.describe("CARD A2 reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reduced motion: the resolve still completes as a crossfade, no develop choreography required", async ({ page, stagedReception, workerEventLoop }, testInfo) => {
    test.setTimeout(240_000);
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 failure evidence in the runner output
    page.on("pageerror", (error) => { console.log(`[rm-pageerror] ${error.message.slice(0, 300)}`); });
    page.on("console", (message) => {
      // eslint-disable-next-line no-console -- deliberate: CARD-A2 failure evidence in the runner output
      if (message.type() === "error") console.log(`[rm-console] ${message.text().slice(0, 200)}`);
    });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await recordStageTimeline(page);
    await stubPlannerBootstrap(page);

    await page.goto("/plan?capture=1&space=reception-room", { waitUntil: "commit" });

    const developing = await stageMilestone(page, "developing", DEVELOPING_WITHIN_MS);
    if (developing === null) await attachStageEvidence(page, testInfo, "reduced-motion", workerEventLoop);
    expect(developing, `the stage reads developing within ${String(DEVELOPING_WITHIN_MS)} ms of the navigation (or the page stopped answering)`).not.toBeNull();
    await expect(page.getByTestId("room-resolve-caption").last()).toBeVisible();
    const settled = await stageMilestone(page, "settled", (developing ?? 0) + SETTLED_AFTER_DEVELOPING_MS);
    await attachStageEvidence(page, testInfo, "reduced-motion", workerEventLoop);
    expect(settled, "the stage resolves and its caption exits").not.toBeNull();
    expect([...stagedReception.requestedFiles].sort()).toEqual([...stagedReception.files].sort());
  });
});
