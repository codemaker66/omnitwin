import { expect, test } from "@playwright/test";

const FORBIDDEN_CLAIMS = [
  /fire approved/i,
  /certified safe/i,
  /legally compliant/i,
  /survey-grade/i,
  /approved for occupancy/i,
  /guaranteed accessible/i,
  /Black Label/i,
  /production ready/i,
  /photoreal digital twin/i,
] as const;

test.describe("Trades Hall internal visual layer route", () => {
  test("loads the empty internal command shell without runtime errors", async ({ page }, testInfo) => {
    const runtimeErrors: string[] = [];

    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/dev/trades-hall-visual");
    await expect(page.getByText("Venviewer")).toBeVisible();
    await expect(page.getByText("Trades Hall Glasgow / Grand Hall")).toBeVisible();
    await expect(page.getByText("Planning evidence / human review required")).toBeVisible();
    await expect(page.getByText("Truth Mode")).toBeVisible();
    await expect(page.getByText("Event Phase Graph")).toBeVisible();
    await expect(page.getByRole("button", { name: /Guest Flow Replay 180 agents/i })).toBeVisible();
    await expect(page.getByText("No real asset loaded yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Machine checked / Not legally certified")).toBeVisible();
    await expect(page.getByText("Simulated guest flow", { exact: true })).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    for (const claim of FORBIDDEN_CLAIMS) {
      await expect(page.getByText(claim)).toHaveCount(0);
    }

    await page.screenshot({ path: testInfo.outputPath("trades-hall-visual-1920.png"), fullPage: false });

    expect(runtimeErrors).toEqual([]);
  });

  test("updates visible shell state from layer and phase controls", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/dev/trades-hall-visual");

    await page.getByRole("button", { name: /Splat/i }).click();
    await expect(page.getByRole("button", { name: /Splat/i })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Bar queue/i }).click();
    await expect(page.getByText(/Wedding ceremony -> dinner flip \/ Bar queue/i)).toBeVisible();

    await page.getByRole("button", { name: /Ops Compiler/i }).click();
    await expect(page.getByRole("button", { name: "Ops", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Hide Heritage buffer/i })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Hide Guest flow replay/i }).click();
    await expect(page.getByRole("button", { name: /Show Guest flow replay/i })).toHaveAttribute("aria-pressed", "false");

    for (const claim of FORBIDDEN_CLAIMS) {
      await expect(page.getByText(claim)).toHaveCount(0);
    }
  });
});
