// ---------------------------------------------------------------------------
// Orthographic Capture — renders a top-down PNG of the room from Three.js
//
// Creates a temporary orthographic camera directly above the room, renders
// a single frame to an offscreen canvas, and returns a PNG data URL.
// Used by the hallkeeper sheet to generate the floor plan diagram.
// ---------------------------------------------------------------------------

import {
  OrthographicCamera,
  WebGLRenderer,
  Scene,
  Color,
} from "three";

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
}

/**
 * Captures a top-down orthographic PNG of the scene.
 *
 * @param scene - The Three.js scene to render (from useThree().scene).
 * @param roomWidthRender - Room width in render-space units (X axis).
 * @param roomLengthRender - Room length in render-space units (Z axis).
 * @param options - Capture dimensions and padding.
 * @returns PNG as a data URL (base64), or null if capture fails.
 */
export function captureOrthographic(
  scene: Scene,
  roomWidthRender: number,
  roomLengthRender: number,
  options: CaptureOptions = {},
): string | null {
  const {
    width = 2400,
    height = 1600,
    padding = 3,
    background = "#f5f5f0",
  } = options;

  try {
    // Offscreen renderer — separate from the main canvas
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1); // fixed for consistent output
    renderer.setClearColor(new Color(background), 1);

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

    // Render
    renderer.render(scene, camera);

    // Extract PNG
    const dataUrl = renderer.domElement.toDataURL("image/png");

    // Cleanup
    renderer.dispose();

    return dataUrl;
  } catch {
    return null;
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
