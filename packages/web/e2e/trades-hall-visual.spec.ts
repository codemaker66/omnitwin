import { expect, test } from "@playwright/test";

test.describe("Trades Hall internal visual layer route", () => {
  test("loads the empty internal command shell without runtime errors", async ({ page }) => {
    const runtimeErrors: string[] = [];

    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.goto("/dev/trades-hall-visual");
    await expect(page.getByText("Venviewer")).toBeVisible();
    await expect(page.getByText("Truth Mode")).toBeVisible();
    await expect(page.getByText("Event Phase Graph")).toBeVisible();
    await expect(page.getByRole("button", { name: /Guest Flow Replay 180 agents/i })).toBeVisible();
    await expect(page.getByText("No real asset loaded yet")).toHaveCount(2);
    await expect(page.getByText("No real asset loaded yet").first()).toBeVisible();
    await expect(page.getByText("Internal command shell demo")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    expect(runtimeErrors).toEqual([]);
  });

  test("updates visible shell state from layer and phase controls", async ({ page }) => {
    await page.goto("/dev/trades-hall-visual");

    await page.getByRole("button", { name: /Splat/i }).click();
    await expect(page.getByRole("button", { name: /Splat/i })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Bar queue/i }).click();
    await expect(page.getByText(/Grand Hall \/ Bar queue/i)).toBeVisible();

    await page.getByRole("button", { name: /Ops Compiler/i }).click();
    await expect(page.getByRole("button", { name: "Ops", exact: true })).toHaveAttribute("aria-pressed", "true");

    await expect(page.getByText(/Black Label/i)).toHaveCount(0);
    await expect(page.getByText(/production ready/i)).toHaveCount(0);
    await expect(page.getByText(/photoreal/i)).toHaveCount(0);
  });

  test("rejects manual splatUrl overrides in production builds", async ({ page }) => {
    test.skip(
      process.env["E2E_EXPECT_PRODUCTION_MANUAL_URL_DISABLED"] !== "true",
      "Run against `vite preview` with E2E_EXPECT_PRODUCTION_MANUAL_URL_DISABLED=true.",
    );

    const externalRuntimeRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (new URL(url).hostname === "assets.venviewer.test") externalRuntimeRequests.push(url);
    });

    await page.goto(
      "/dev/trades-hall-visual?splatUrl=https%3A%2F%2Fassets.venviewer.test%2Ftrades-hall%2Fscene.ply",
    );

    const disabledManualUrlMessage = page.getByText(
      "Manual runtime asset URLs are disabled in this build; use a registered runtime package.",
    );
    await expect(disabledManualUrlMessage).toHaveCount(2);
    await expect(disabledManualUrlMessage.first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(externalRuntimeRequests).toEqual([]);
  });
});
