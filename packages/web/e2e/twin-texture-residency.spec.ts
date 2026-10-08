import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Twin texture residency (T-644) — a streamed upload must equal a whole one.
//
// texture-residency.ts allocates a pano's storage without data and fills it
// with sub-rectangle copies from the same ImageBitmap, so the GPU never takes
// one ~33.5 MB call. Its unit tests prove the strip arithmetic against a fake
// renderer; only a real browser can prove that three's copyTextureToTexture,
// the browser's sub-rectangle unpack of an ImageBitmap and the driver put
// every texel where a single `initTexture` would. This spec streams a
// deterministic 4096x2048 bitmap through the real module and three, reads both
// textures back and requires them to be byte-identical.
//
// The page is a routed stub on the dev server's own origin, so the module and
// three come through Vite exactly as the app loads them (the same three
// instance the module imports, found from the module's transformed source).
// ---------------------------------------------------------------------------

test.use({
  launchOptions: {
    args: ["--use-gl=angle", "--use-angle=gl", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  },
});

interface ResidencyResult {
  readonly steps: number;
  readonly differing: number;
  readonly nonzero: number;
  readonly bytes: number;
  readonly resident: boolean;
  readonly error: string | null;
}

declare global {
  interface Window {
    __residencyResult?: ResidencyResult;
  }
}

const STUB_PATH = "/__twin-texture-residency";

const CHECK = `
const W = 4096, H = 2048;
try {
  const residency = await import("/src/twin/texture-residency.ts");
  const source = await (await fetch("/src/twin/texture-residency.ts")).text();
  const match = source.match(/from\\s*["']([^"']*three[^"']*)["']/);
  if (match === null) throw new Error("three import not found in the transformed module");
  const THREE = await import(match[1]);
  const canvas = new OffscreenCanvas(W, H);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(W, H);
  let seed = 7;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const row = (i / 4 / W) | 0;
    pixels.data[i] = seed & 255;
    pixels.data[i + 1] = row & 255;
    pixels.data[i + 2] = (row >> 3) & 255;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
  const make = () => {
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };
  const whole = make();
  renderer.initTexture(whole);
  const streamed = make();
  let steps = 1;
  while (!residency.advanceTextureResidency(renderer, streamed, () => true)) {
    steps += 1;
    if (steps > 2000) throw new Error("the streamed texture never became resident");
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const gl = renderer.getContext();
  const read = (texture) => {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
      renderer.properties.get(texture).__webglTexture, 0);
    const out = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    return out;
  };
  const a = read(whole);
  const b = read(streamed);
  let differing = 0;
  let nonzero = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) differing += 1;
    if (b[i] !== 0) nonzero += 1;
  }
  window.__residencyResult = {
    steps, differing, nonzero, bytes: a.length,
    resident: residency.isTextureResident(renderer, streamed), error: null,
  };
} catch (error) {
  window.__residencyResult = {
    steps: 0, differing: -1, nonzero: 0, bytes: 0, resident: false,
    error: String(error && error.stack ? error.stack : error),
  };
}
`;

test("a pano streamed in bounded steps is byte-identical to a whole upload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(`**${STUB_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>residency</title>" }),
  );
  await page.goto(STUB_PATH);
  await page.addScriptTag({ type: "module", content: CHECK });
  await page.waitForFunction(() => window.__residencyResult !== undefined, undefined, {
    timeout: 110_000,
  });
  const result = await page.evaluate(() => window.__residencyResult);
  expect(result?.error ?? null, "the in-page check threw").toBeNull();
  expect(result?.steps, "a 4096x2048 base takes several bounded steps").toBeGreaterThan(1);
  expect(result?.resident).toBe(true);
  expect(result?.bytes).toBe(4096 * 2048 * 4);
  expect(result?.nonzero, "the streamed texture holds the pattern, not empty storage").toBeGreaterThan(
    4096 * 2048 * 3,
  );
  expect(result?.differing, "texels that differ from the whole upload").toBe(0);
});
