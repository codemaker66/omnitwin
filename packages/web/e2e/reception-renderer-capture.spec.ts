import { expect, test, type Page } from "@playwright/test";

const SPLAT_COUNT = 25;

interface CapturedFrame {
  readonly presentedFrameId: string;
  readonly rendererFrameDigest: string;
  readonly framebufferPixelSha256: string;
  readonly framebufferRgbaBase64: string;
  readonly loadedSplatCount: number;
  readonly loadedSourceCount: number;
  readonly renderer: { readonly drawingBufferWidth: number; readonly drawingBufferHeight: number };
}

interface FrameSummary {
  readonly id: string;
  readonly digest: string;
  readonly pixelDigest: string;
  readonly pixelBytes: number;
  readonly uniquePixelValues: number;
  readonly splats: number;
  readonly sources: number;
  readonly width: number;
  readonly height: number;
}

declare global {
  interface Window {
    __splatFixture?: {
      readonly status: "loading" | "loaded" | "error";
      readonly results: readonly unknown[];
    };
    __venviewerCaptureV1?: {
      readonly capture: (request: unknown) => Promise<CapturedFrame>;
    };
  }
}

function generatedGaussianPly(): Buffer {
  const header = [
    "ply", "format binary_little_endian 1.0", `element vertex ${String(SPLAT_COUNT)}`,
    "property float x", "property float y", "property float z",
    "property float f_dc_0", "property float f_dc_1", "property float f_dc_2",
    "property float opacity", "property float scale_0", "property float scale_1",
    "property float scale_2", "property float rot_0", "property float rot_1",
    "property float rot_2", "property float rot_3", "end_header",
  ];
  const rows = Array.from({ length: SPLAT_COUNT }, (_, index) => {
    const x = (index % 5 - 2) * 0.3;
    const y = (Math.floor(index / 5) - 2) * 0.3;
    const colour = index % 2 === 0 ? [0.8, -0.2, -0.2] : [-0.2, 0.5, 0.8];
    return [x, 2.8, y, ...colour, 4, -2.6, -2.6, -2.6, 1, 0, 0, 0];
  });
  const body = Buffer.alloc(SPLAT_COUNT * 14 * 4);
  rows.flat().forEach((value, index) => body.writeFloatLE(value, index * 4));
  return Buffer.concat([Buffer.from(`${header.join("\n")}\n`), body]);
}

function watchRuntime(page: Page): { runtimeErrors: string[]; imageRequests: string[] } {
  const runtimeErrors: string[] = [];
  const imageRequests: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url());
  });
  return { runtimeErrors, imageRequests };
}

async function waitForGeneratedScene(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__splatFixture !== undefined
    && window.__splatFixture.status !== "loading");
  const fixture = await page.evaluate(() => window.__splatFixture);
  expect(fixture?.status, JSON.stringify(fixture?.results)).toBe("loaded");
  await page.waitForFunction(() => typeof window.__venviewerCaptureV1?.capture === "function");
}

async function captureTwice(page: Page): Promise<FrameSummary[]> {
  return page.evaluate(async () => {
    const api = window.__venviewerCaptureV1;
    if (api === undefined) throw new Error("capture adapter missing");
    const request = {
      schemaVersion: "venviewer.reception-renderer-capture.v1" as const,
      protocolDigest: "a".repeat(64),
      challengeNonce: "synthetic-001",
    };
    const frames = [await api.capture(request), await api.capture(request)];
    return frames.map((frame) => {
      const binary = atob(frame.framebufferRgbaBase64);
      const uniquePixels = new Set<string>();
      for (let index = 0; index < binary.length; index += 4) {
        uniquePixels.add([
          binary.charCodeAt(index), binary.charCodeAt(index + 1),
          binary.charCodeAt(index + 2), binary.charCodeAt(index + 3),
        ].join(","));
      }
      return {
        id: frame.presentedFrameId,
        digest: frame.rendererFrameDigest,
        pixelDigest: frame.framebufferPixelSha256,
        pixelBytes: binary.length,
        uniquePixelValues: uniquePixels.size,
        splats: frame.loadedSplatCount,
        sources: frame.loadedSourceCount,
        width: frame.renderer.drawingBufferWidth,
        height: frame.renderer.drawingBufferHeight,
      };
    });
  });
}

function assertFrameProof(frames: readonly FrameSummary[]): void {
  expect(frames[0]?.splats).toBe(SPLAT_COUNT);
  expect(frames[0]?.sources).toBe(1);
  expect(frames[0]?.pixelBytes).toBe(160 * 120 * 4);
  expect(frames[0]?.uniquePixelValues).toBeGreaterThan(100);
  expect(frames[0]?.width).toBe(160);
  expect(frames[0]?.height).toBe(120);
  expect(frames[0]?.pixelDigest).toMatch(/^[a-f0-9]{64}$/u);
  expect(frames[0]?.pixelDigest).toBe(frames[1]?.pixelDigest);
  expect(frames[0]?.id).not.toBe(frames[1]?.id);
  expect(frames[0]?.digest).not.toBe(frames[1]?.digest);
}

async function wrongChallengeError(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = window.__venviewerCaptureV1;
    if (api === undefined) throw new Error("capture adapter missing");
    try {
      await api.capture({
        schemaVersion: "venviewer.reception-renderer-capture.v1",
        protocolDigest: "a".repeat(64),
        challengeNonce: "wrong-page",
      });
      return "capture unexpectedly succeeded";
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

test("generated splats produce renderer-owned fresh frame pixels", async ({ page }) => {
  const watched = watchRuntime(page);
  await page.route("**/generated-capture.ply", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: generatedGaussianPly(),
  }));
  await page.setViewportSize({ width: 160, height: 120 });
  await page.goto(
    "/dev/splat-fixture?splatUrl=/generated-capture.ply&captureNonce=synthetic-001&zUp=1",
  );
  await waitForGeneratedScene(page);
  assertFrameProof(await captureTwice(page));
  expect(await wrongChallengeError(page)).toContain("does not match this page");
  expect(watched.imageRequests).toEqual([]);
  expect(watched.runtimeErrors).toEqual([]);
});
