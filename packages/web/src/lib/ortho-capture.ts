// ---------------------------------------------------------------------------
// Orthographic Capture — renders a top-down image of the room from Three.js
//
// Creates a temporary orthographic camera directly above the room, renders
// a single frame to an offscreen native render target, and returns a PNG or
// JPEG data URL. Its plan thumbnail (PLAN_THUMBNAIL) is sent with a layout and
// printed as the hallkeeper sheet's floor plan diagram.
// ---------------------------------------------------------------------------

import {
  OrthographicCamera,
  RenderTarget,
  SRGBColorSpace,
  UnsignedByteType,
  type Scene,
  Color,
} from "three";
import { prepareFurnitureForOrthographicCapture } from "./layout-timeline-capture.js";
import { nativeRendererForScene } from "./native-renderer.js";
import { withNativeSplatCapture } from "./native-splat-scene.js";

/** Capture options. */
export interface CaptureOptions {
  /** Width in pixels (default 2400 for 300dpi on A4 landscape diagram zone). */
  readonly width?: number;
  /** Height in pixels (default 1600). */
  readonly height?: number;
  /** Padding around room bounds in world units (default 2). */
  readonly padding?: number;
  /** Background colour (default white). */
  readonly background?: string;
  /** Image type (default PNG). */
  readonly type?: "image/png" | "image/jpeg";
  /** JPEG quality, 0-1 (default 0.85). */
  readonly quality?: number;
  /** The longest data URL wanted: JPEG steps down in quality to fit it; otherwise null. */
  readonly maxLength?: number;
}

/** The API's cap on a thumbnail data URL (MAX_THUMBNAIL_STRING_LEN, api/src/routes/public-configs.ts). */
export const THUMBNAIL_MAX_LENGTH = 270_000;

/**
 * The plan sent with a layout (Send layout, Submit for review) and printed on
 * the hallkeeper sheet. JPEG: the Grand Hall's 800×533 plan is 685,350
 * characters as a PNG data URL, which the API refused, and 96,443 as this JPEG.
 */
export const PLAN_THUMBNAIL: CaptureOptions = {
  width: 800, height: 533, type: "image/jpeg", quality: 0.85, maxLength: THUMBNAIL_MAX_LENGTH,
};

/** Lower JPEG qualities tried, in turn, for an image over its `maxLength`. */
const FALLBACK_QUALITIES = [0.75, 0.65, 0.55] as const;

/**
 * Captures a top-down orthographic image of the scene.
 *
 * @param scene - The Three.js scene to render (from useThree().scene).
 * @param roomWidthRender - Room width in render-space units (X axis).
 * @param roomLengthRender - Room length in render-space units (Z axis).
 * @param options - Capture dimensions, padding and encoding.
 * @returns The image as a data URL (base64), or null if the capture fails, is
 *   blank (every pixel the same) or cannot fit `maxLength`.
 */
export async function captureOrthographic(
  scene: Scene,
  roomWidthRender: number,
  roomLengthRender: number,
  options: CaptureOptions = {},
): Promise<string | null> {
  const {
    width = 2400,
    height = 1600,
    padding = 3,
    background = "#f5f5f0",
    type = "image/png",
    quality = 0.85,
    maxLength,
  } = options;
  const renderer = nativeRendererForScene(scene);
  if (renderer === null || !Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0 || width > 8192 || height > 8192
    || !Number.isFinite(roomWidthRender) || roomWidthRender <= 0
    || !Number.isFinite(roomLengthRender) || roomLengthRender <= 0
    || !Number.isFinite(padding) || padding < 0) return null;
  const renderTarget = new RenderTarget(width, height, {
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    depthBuffer: true,
  });

  // The DiagramLabels React component keeps labels hidden by default. Saved
  // plan captures show them; a timeline keyframe capture must suppress them
  // because those labels still come from the editable placement store.
  const labelsGroup = scene.getObjectByName("diagram-labels");
  const labelsWereVisible = labelsGroup?.visible ?? false;
  // A scrubbed in-between layout is presentational, never export evidence.
  // Substitute the nearest immutable phase keyframe for this render, or the
  // editor's saved layout when no timeline keyframe is mounted.
  try {
    // Orthographic camera looking straight down
    const halfW = roomWidthRender / 2 + padding;
    const halfL = roomLengthRender / 2 + padding;

    // Maintain aspect ratio — fit room into the capture dimensions
    const aspect = width / height;
    const roomAspect = halfW / halfL;

    let camHalfW: number;
    let camHalfL: number;
    if (roomAspect > aspect) {
      // Room is wider than canvas — fit by width
      camHalfW = halfW;
      camHalfL = halfW / aspect;
    } else {
      // Room is taller — fit by length
      camHalfL = halfL;
      camHalfW = halfL * aspect;
    }

    const camera = new OrthographicCamera(
      -camHalfW, camHalfW,   // left, right
      camHalfL, -camHalfL,   // top, bottom (Z axis: negative = front)
      0.1, 200,
    );
    camera.position.set(0, 50, 0); // high above
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousBackground = scene.background;
    const previousAutoClear = renderer.autoClear;
    const previousXr = renderer.xr.enabled;
    const furnitureCapture = prepareFurnitureForOrthographicCapture(scene);
    // All changes to the live scene/device are scoped to one synchronous draw.
    // Pixel readback can await the GPU without flashing labels, replacing the
    // visible camera or holding timeline furniture in its capture state.
    try {
      if (labelsGroup !== undefined) labelsGroup.visible = furnitureCapture.diagramLabelsVisible;
      scene.background = new Color(background);
      renderer.autoClear = true;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(renderTarget);
      withNativeSplatCapture(scene, camera, () => { renderer.render(scene, camera); });
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXr;
      scene.background = previousBackground;
      if (labelsGroup !== undefined) labelsGroup.visible = labelsWereVisible;
      furnitureCapture.restore();
    }
    const pixels = await renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
    const webgl = "isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true;
    // r186's WebGPU readback retains its mandatory 256-byte row alignment;
    // the last row ends at the image width. WebGL returns contiguous rows.
    const rowStride = webgl ? width * 4 : Math.ceil(width * 4 / 256) * 256;
    const expectedBytes = (height - 1) * rowStride + width * 4;
    if (!(pixels instanceof Uint8Array) || pixels.length !== expectedBytes) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    const image = context.createImageData(width, height);
    copyNativeCapturePixels(pixels, image.data, width, height, webgl, rowStride);
    // A draw that drew nothing (a refused pipeline, a lost device) reads back as
    // one colour: no plan beats a blank one.
    if (isUniformImage(image.data)) return null;
    context.putImageData(image, 0, 0);
    const qualities = type === "image/jpeg" ? [quality, ...FALLBACK_QUALITIES.filter((step) => step < quality)] : [undefined];
    for (const step of qualities) {
      const url = step === undefined ? canvas.toDataURL(type) : canvas.toDataURL(type, step);
      if (maxLength === undefined || url.length <= maxLength) return url;
    }
    return null;
  } catch {
    return null;
  } finally {
    renderTarget.dispose();
  }
}

/** Whether every pixel of an RGBA image is the same: a capture that drew nothing. */
export function isUniformImage(data: Uint8ClampedArray): boolean {
  const pixels = new Uint32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
  const first = pixels[0];
  for (let index = 1; index < pixels.length; index += 1) {
    if (pixels[index] !== first) return false;
  }
  return true;
}

/** Canvas images are top-down; WebGL readback starts at its lower-left corner. */
export function copyNativeCapturePixels(
  pixels: Uint8Array, output: Uint8ClampedArray, width: number, height: number, flipY: boolean,
  rowStride = width * 4,
): void {
  const rowBytes = width * 4;
  for (let row = 0; row < height; row += 1) {
    const sourceRow = flipY ? height - row - 1 : row;
    output.set(pixels.subarray(sourceRow * rowStride, sourceRow * rowStride + rowBytes), row * rowBytes);
  }
}

/**
 * Converts a data URL to a Blob for upload.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) return new Blob([], { type: "image/png" });
  const header = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
