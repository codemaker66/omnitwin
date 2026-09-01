import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { API, settleCockpit, stubPlannerBootstrap } from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// Stage S2 — the hands (T-561).
//
// The pill's DOM state machine and the judged clearance ring, on a booted
// cockpit with the whole backend stubbed (no live API, splat tiles 404 so the
// room plans on reviewed geometry — the pill owes nothing to the captured
// layer). Furniture is staged through the DEV __plannerHands bridge: placing
// through the catalogue drawer would couple this evidence to drawer
// choreography, and the ring's judgement needs an EXACT 0.60 m planning gap.
//
// GPU e2e law: one file, serial with the others via the shared config.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __plannerHands?: {
      placeTable: (x: number, z: number) => string | null;
      select: (id: string) => void;
      activeTool: () => string;
    };
  }
}

/** 6ft Round Table (round-table-6ft) is 1.83 m across — asset-catalogue.ts. */
const TABLE_WIDTH_M = 1.83;
/** Inside [blockedM 0.45, tightM 0.90) → the amber "single-file" reason. */
const STAGED_GAP_M = 0.6;

/** Runner cwd is packages/web; evidence lands beside the other stage proofs. */
const EVIDENCE_PATH = resolve(
  process.cwd(),
  "../../docs/evidence/stage/2026-09-01-s2-hands-pill-and-ring.png",
);

test.describe("Stage S2 — the tool pill and the clearance ring", () => {
  // Wide enough for the pill's labels (they collapse to icons below 1280).
  test.use({ viewport: { width: 1680, height: 1000 } });

  test("five hands, the Escape ladder, and a judged amber ring", async ({ page }) => {
    // Boot + resolve choreography on a churned worker can exceed the default
    // 30s (the S1 lesson); the interactions themselves are fast.
    test.setTimeout(180_000);
    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });
    // No captured layer in this spec: the staged-capture path would stream
    // real SOG tiles and the pill owes nothing to them.
    await page.route("**/splats/**", (route) => {
      void route.fulfill({ status: 404, body: "not in this spec" });
    });

    await page.goto("/plan");
    await settleCockpit(page);

    // Interact only with a settled stage: the resolve choreography animates
    // ancestors of the pill, and a moving bounding box fails Playwright's
    // stability check in a way that reads as a mystery timeout. With the
    // captured layer stubbed away the phase must land on "fallback".
    await expect
      .poll(
        () => page.evaluate(() =>
          document.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase") ?? "missing",
        ),
        { timeout: 90_000, message: "waiting for the room resolve to settle" },
      )
      .toMatch(/^(resolved|fallback)$/);

    // The pill: five hands, Select in hand.
    const pill = page.getByTestId("planner-tool-pill");
    await expect(pill).toBeVisible();
    for (const tool of ["select", "move", "rotate", "scale", "measure"]) {
      await expect(page.getByTestId(`planner-tool-${tool}`)).toBeVisible();
    }
    await expect(page.getByTestId("planner-tool-select")).toHaveAttribute("aria-pressed", "true");

    // Taking a hand by click.
    await page.getByTestId("planner-tool-rotate").click();
    await expect(page.getByTestId("planner-tool-rotate")).toHaveAttribute("aria-pressed", "true");

    // Escape backs out one layer: rotate → select.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("planner-tool-select")).toHaveAttribute("aria-pressed", "true");

    // M is the tape's own key, routed through the store; M again puts it away.
    await page.keyboard.press("KeyM");
    await expect(page.getByTestId("planner-tool-measure")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("KeyM");
    await expect(page.getByTestId("planner-tool-select")).toHaveAttribute("aria-pressed", "true");

    // Stage two tables an exact 0.60 m apart and select the first.
    const staged = await page.evaluate(
      ([tableWidth, gap]) => {
        const hands = window.__plannerHands;
        if (hands === undefined) return null;
        const a = hands.placeTable(2, 2);
        const b = hands.placeTable(2 + tableWidth + gap, 2);
        if (a === null || b === null) return null;
        hands.select(a);
        return { a, b };
      },
      [TABLE_WIDTH_M, STAGED_GAP_M] as const,
    );
    expect(staged).not.toBeNull();

    // The ring judges the gap and says why, in planning-grade language.
    const reason = page.getByTestId("clearance-ring-reason");
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(/0\.60 m to 6ft Round Table — needs 0\.90 m single-file/);
    await expect(reason).toHaveAttribute("title", "Planning-grade clearance estimate");

    // Visual evidence at the judgement moment: pill + amber ring + reason.
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    const shot = await page.screenshot({ path: EVIDENCE_PATH });
    await test.info().attach("s2-hands-pill-and-ring", { body: shot, contentType: "image/png" });

    // The value chip reads the selected table's rotation, tabular.
    await page.getByTestId("planner-tool-rotate").click();
    await expect(page.getByTestId("planner-tool-value")).toHaveText("0°");
  });
});
