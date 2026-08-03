import { expect, test } from "@playwright/test";

interface SparkWorkerStats {
  readonly created: number;
  readonly terminated: number;
}

declare global {
  interface Window {
    readonly __sparkWorkerStats?: SparkWorkerStats;
  }
}

test.describe("Spark fixture", () => {
  test("loads the Three.js 0.180 + Spark smoke route", async ({ page }) => {
    const runtimeErrors: string[] = [];

    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });

    await page.goto("/dev/splat-fixture");
    await expect(page.getByText("Spark fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Three.js 0.180 + Spark 2.0 smoke route.")).toBeVisible();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(async () => {
      const box = await canvas.boundingBox();
      return box === null ? 0 : Math.min(box.width, box.height);
    }).toBeGreaterThan(300);

    expect(runtimeErrors).toEqual([]);
  });

  test("unmounts a real local SOG decode without a worker-termination error", async ({ page }) => {
    const runtimeErrors: string[] = [];
    await page.addInitScript(() => {
      const nativeWorker = window.Worker;
      const stats = { created: 0, terminated: 0 };
      class TrackedWorker extends nativeWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          stats.created += 1;
        }

        override terminate(): void {
          stats.terminated += 1;
          super.terminate();
        }
      }
      Object.defineProperty(window, "Worker", { configurable: true, value: TrackedWorker });
      Object.defineProperty(window, "__sparkWorkerStats", { configurable: true, value: stats });
    });
    page.on("pageerror", (error) => { runtimeErrors.push(error.message); });
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await page.goto("/dev/splat-fixture?splatUrl=/splats/reception/0_15_0_0.sog");
    await expect(page.locator("canvas")).toBeVisible();
    await page.evaluate(() => {
      window.history.pushState({}, "", "/privacy");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.waitForTimeout(1_000);
    const workerStats = await page.evaluate(() => {
      const stats = window.__sparkWorkerStats;
      if (stats === undefined) throw new Error("Spark worker instrumentation was not installed");
      return stats;
    });

    expect(runtimeErrors).toEqual([]);
    expect(workerStats.created).toBeGreaterThanOrEqual(2);
    expect(workerStats.terminated).toBeGreaterThanOrEqual(2);
    expect(workerStats.created - workerStats.terminated).toBeLessThanOrEqual(1);
  });
});
