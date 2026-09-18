import { RenderTarget, SRGBColorSpace, UnsignedByteType, Vector2, type Camera, type Scene } from "three";
import { nativeRendererForScene } from "./native-renderer.js";
import { copyNativeCapturePixels } from "./ortho-capture.js";

export interface NativeCurrentViewCapture {
  readonly width: number;
  readonly height: number;
  readonly dataUrl: string;
}

/** Capture the current camera on its existing device, independent of whether
 * the browser preserves the presented canvas buffer. Never move the camera. */
export async function captureNativeCurrentView(scene: Scene, camera: Camera): Promise<NativeCurrentViewCapture> {
  const renderer = nativeRendererForScene(scene);
  if (renderer === null) throw new Error("The room has no initialized native renderer");
  const size = renderer.getDrawingBufferSize(new Vector2());
  const width = size.x, height = size.y;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error("The room canvas has invalid capture dimensions");
  }
  const target = new RenderTarget(width, height, {
    type: UnsignedByteType, colorSpace: SRGBColorSpace, depthBuffer: true,
  });
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousMip = renderer.getActiveMipmapLevel();
  const previousAutoClear = renderer.autoClear;
  const previousXr = renderer.xr.enabled;
  try {
    try {
      renderer.autoClear = true;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXr;
    }
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    const webgl = "isWebGLBackend" in renderer.backend && renderer.backend.isWebGLBackend === true;
    const stride = webgl ? width * 4 : Math.ceil(width * 4 / 256) * 256;
    if (!(pixels instanceof Uint8Array) || pixels.length !== (height - 1) * stride + width * 4) {
      throw new Error("Native poster readback returned an incomplete image");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Poster encoding requires a 2D canvas");
    const image = context.createImageData(width, height);
    copyNativeCapturePixels(pixels, image.data, width, height, webgl, stride);
    let visible = false, varied = false;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      visible ||= (image.data[offset + 3] ?? 0) > 0;
      for (let channel = 0; channel < 4; channel += 1) {
        varied ||= image.data[offset + channel] !== image.data[channel];
      }
    }
    if (!visible || !varied) throw new Error("Native poster readback is blank; no poster was produced");
    context.putImageData(image, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("Poster JPEG encoding failed");
    return { width, height, dataUrl };
  } finally {
    target.dispose();
  }
}
