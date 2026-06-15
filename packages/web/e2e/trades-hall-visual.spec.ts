import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:3001";
const RECEPTION_ROOM_ROUTE = "/dev/trades-hall-visual?venue=trades-hall&room=reception-room";
const RECEPTION_ROOM_RUNTIME_PACKAGE_ID = "71687e9e-c23d-4f51-b3dd-a6a82c97978d";

interface VisualRouteIssue {
  readonly status?: number;
  readonly url?: string;
  readonly text?: string;
}

interface VisualRouteIssues {
  readonly blockingResponses: VisualRouteIssue[];
  readonly requestFailures: VisualRouteIssue[];
  readonly pageErrors: string[];
  readonly unexpectedConsole: string[];
  readonly packageResponses: VisualRouteIssue[];
  readonly runtimeAssetResponses: VisualRouteIssue[];
}

function isAllowedUnauthenticatedAdjunctResponse(status: number, rawUrl: string): boolean {
  if (status !== 401) return false;
  const parsed = new URL(rawUrl);
  return parsed.origin === API && (
    parsed.pathname === "/ai/status" ||
    parsed.pathname === "/truth-mode/summary"
  );
}

function isKnownDevConsoleNoise(text: string): boolean {
  return text.startsWith("Failed to load resource:") ||
    text.includes("Clerk has been loaded with development keys") ||
    text.startsWith("THREE.WebGLProgram: Program Info Log:") ||
    text.includes("GPU stall due to ReadPixels");
}

function watchVisualRouteIssues(page: Page): VisualRouteIssues {
  const issues: VisualRouteIssues = {
    blockingResponses: [],
    requestFailures: [],
    pageErrors: [],
    unexpectedConsole: [],
    packageResponses: [],
    runtimeAssetResponses: [],
  };

  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (url.startsWith(`${API}/assets/runtime-packages/latest`)) {
      issues.packageResponses.push({ status, url });
    }
    if (url.startsWith(`${API}/assets/runtime-assets/`)) {
      issues.runtimeAssetResponses.push({ status, url });
    }
    if (status >= 400 && !isAllowedUnauthenticatedAdjunctResponse(status, url)) {
      issues.blockingResponses.push({ status, url });
    }
  });

  page.on("requestfailed", (request) => {
    issues.requestFailures.push({
      url: request.url(),
      text: request.failure()?.errorText ?? "unknown request failure",
    });
  });

  page.on("pageerror", (error) => {
    issues.pageErrors.push(error.message);
  });

  page.on("console", (message) => {
    const text = message.text();
    if ((message.type() === "error" || message.type() === "warning") && !isKnownDevConsoleNoise(text)) {
      issues.unexpectedConsole.push(text);
    }
  });

  return issues;
}

test.describe("Trades Hall internal visual layer route", () => {
  test.describe("procedural fallback", () => {
    test.beforeEach(async ({ page }) => {
      // The route fetches the latest published runtime package on mount. With
      // no local API the browser logs net::ERR_CONNECTION_REFUSED, tripping the
      // zero-console-error guard below even though the page falls back to the
      // procedural layer gracefully. Mock the lookup to its empty result so the
      // spec exercises the same no-asset state without a live API. (T-449)
      await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
        void route.fulfill({ json: { data: null } });
      });
    });

    test("loads the empty internal command shell without runtime errors", async ({ page }) => {
      const issues = watchVisualRouteIssues(page);

      await page.goto("/dev/trades-hall-visual");
      await expect(page.getByText("Venviewer")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Truth Mode", exact: true })).toBeVisible();
      await expect(page.getByText("Event Phase Graph")).toBeVisible();
      await expect(page.getByRole("button", { name: /Guest Flow Replay \d+ agents/i })).toBeVisible();
      await expect(page.getByText("No real asset loaded yet")).toHaveCount(2);
      await expect(page.getByText("No real asset loaded yet").first()).toBeVisible();
      await expect(page.getByText("Internal command shell demo")).toBeVisible();

      const canvas = page.locator("canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(async () => {
        const box = await canvas.boundingBox();
        return box === null ? 0 : Math.min(box.width, box.height);
      }).toBeGreaterThan(300);

      expect(issues.blockingResponses).toEqual([]);
      expect(issues.requestFailures).toEqual([]);
      expect(issues.pageErrors).toEqual([]);
      expect(issues.unexpectedConsole).toEqual([]);
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

  test("keeps the Reception Room route safe when unauthenticated adjunct APIs return 401", async ({ page }) => {
    const issues = watchVisualRouteIssues(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: null } });
    });
    await page.route(`${API}/ai/status`, (route) => {
      void route.fulfill({ status: 401, json: { error: "authentication required" } });
    });
    await page.route(`${API}/truth-mode/summary*`, (route) => {
      void route.fulfill({ status: 401, json: { error: "authentication required" } });
    });

    await page.goto(RECEPTION_ROOM_ROUTE);

    await expect(page.getByText(/Reception Room \/ Dinner/i)).toBeVisible();
    await expect(page.getByText("No real asset loaded yet").first()).toBeVisible();
    await expect(page.getByText("Manual runtime URLs are disabled here")).toBeVisible();
    await expect(page.getByText(/Runtime asset loaded, not yet verified\/signed/i)).toHaveCount(0);
    expect(issues.packageResponses.length).toBeGreaterThan(0);
    expect(issues.packageResponses.every((response) => response.status === 200)).toBe(true);
    expect(
      issues.packageResponses.every((response) => (
        response.url === `${API}/assets/runtime-packages/latest?venue=trades-hall&room=reception-room`
      )),
    ).toBe(true);
    expect(issues.runtimeAssetResponses).toEqual([]);
    expect(issues.blockingResponses).toEqual([]);
    expect(issues.requestFailures).toEqual([]);
    expect(issues.pageErrors).toEqual([]);
    expect(issues.unexpectedConsole).toEqual([]);
  });

  test("loads the registered Reception Room runtime package with no-auth-safe ancillary failures", async ({ page }) => {
    test.skip(
      process.env["E2E_RECEPTION_ROOM_RUNTIME_PACKAGE"] !== "true",
      "Requires local API/R2 access with the Reception Room runtime package registered.",
    );
    test.setTimeout(150_000);

    const issues = watchVisualRouteIssues(page);
    await page.goto(RECEPTION_ROOM_ROUTE);

    await expect(page.getByText(RECEPTION_ROOM_RUNTIME_PACKAGE_ID)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/Runtime asset loaded, not yet verified\/signed \(3,491,322 splats\)/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByText("Manual runtime URLs are disabled here")).toBeVisible();
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("No real asset loaded yet");

    expect(issues.packageResponses.some((response) => response.status === 200)).toBe(true);
    expect(issues.runtimeAssetResponses).toHaveLength(7);
    expect(issues.runtimeAssetResponses.every((response) => response.status === 200)).toBe(true);
    expect(issues.blockingResponses).toEqual([]);
    expect(issues.requestFailures).toEqual([]);
    expect(issues.pageErrors).toEqual([]);
    expect(issues.unexpectedConsole).toEqual([]);
  });
});
