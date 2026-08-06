import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { SplatMesh } from "@sparkjsdev/spark";
import type { Object3D } from "three";
import {
  SPARK_CAPTURE_USER_DATA_KEY,
  type SparkPresentedFrameEvent,
} from "../../components/scene/SparkSplatLayer.js";
import {
  RECEPTION_CAPTURE_SCHEMA_VERSION,
  RECEPTION_CAPTURE_BINDING_MANIFEST,
  assertReceptionCaptureId,
  receptionFrameDigest,
  type ReceptionCaptureConfiguration,
} from "./reception-capture-contract.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const REQUEST_KEYS = ["challengeNonce", "protocolDigest", "schemaVersion"] as const;
const CAPTURE_SETTLE_TIMEOUT_MS = 60_000;

export interface ReceptionCaptureRequest {
  readonly schemaVersion: typeof RECEPTION_CAPTURE_SCHEMA_VERSION;
  readonly protocolDigest: string;
  readonly challengeNonce: string;
}

export interface ReceptionCaptureResult {
  readonly schemaVersion: typeof RECEPTION_CAPTURE_SCHEMA_VERSION;
  readonly protocolDigest: string;
  readonly challengeNonce: string;
  readonly documentSessionId: string;
  readonly renderSequence: number;
  readonly presentedFrameId: string;
  readonly candidateId: string;
  readonly viewId: string;
  readonly assetSetSha256: string;
  readonly assetReceipts: readonly Record<string, unknown>[];
  readonly profileId: string;
  readonly loadedSourceCount: number;
  readonly loadedSplatCount: number;
  readonly rendererBinding: ReceptionCaptureConfiguration["rendererBinding"];
  readonly camera: Record<string, unknown>;
  readonly renderer: Record<string, unknown>;
  readonly framebufferPixelSha256: string;
  readonly rendererFrameDigest: string;
  readonly framebufferRgbaBase64: string;
}

interface PendingCapture {
  readonly request: ReceptionCaptureRequest;
  readonly resolve: (result: ReceptionCaptureResult) => void;
  readonly reject: (error: Error) => void;
  attempts: number;
  finishing: boolean;
  lastActiveSplatCount: number | null;
  readonly startedAtMs: number;
  cancelDeadline: () => void;
}

interface ReceptionCaptureApi {
  readonly capture: (request: unknown) => Promise<ReceptionCaptureResult>;
}

declare global {
  interface Window {
    __venviewerCaptureV1?: ReceptionCaptureApi;
  }
}

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function validateReceptionCaptureRequest(
  value: unknown,
  expectedNonce: string,
): ReceptionCaptureRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Capture request must be one object.");
  }
  const raw = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify([...REQUEST_KEYS].sort())) {
    throw new Error("Capture request fields are invalid.");
  }
  if (raw.schemaVersion !== RECEPTION_CAPTURE_SCHEMA_VERSION) {
    throw new Error("Capture request version is invalid.");
  }
  if (typeof raw.protocolDigest !== "string" || !SHA256.test(raw.protocolDigest)) {
    throw new Error("Capture protocol digest is invalid.");
  }
  if (typeof raw.challengeNonce !== "string") throw new Error("Capture challenge is invalid.");
  const challengeNonce = assertReceptionCaptureId(raw.challengeNonce, "Capture challenge");
  if (challengeNonce !== expectedNonce) throw new Error("Capture challenge does not match this page.");
  return { schemaVersion: RECEPTION_CAPTURE_SCHEMA_VERSION, protocolDigest: raw.protocolDigest, challengeNonce };
}

export function scheduleReceptionCaptureDeadline(onTimeout: () => void): () => void {
  const timeoutId = window.setTimeout(onTimeout, CAPTURE_SETTLE_TIMEOUT_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

export function assertReceptionCaptureWithinDeadline(
  startedAtMs: number,
  nowMs: number = performance.now(),
): void {
  if (nowMs - startedAtMs >= CAPTURE_SETTLE_TIMEOUT_MS) {
    throw new Error("Spark did not complete the capture within 60 seconds.");
  }
}

function releasePendingCapture(
  pending: { current: PendingCapture | null },
  active: PendingCapture,
): boolean {
  if (pending.current !== active) return false;
  pending.current = null;
  active.cancelDeadline();
  return true;
}

function isActuallyVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function numericArrayClose(value: unknown, expected: readonly number[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => typeof entry === "number"
      && Number.isFinite(entry) && Math.abs(entry - (expected[index] ?? 0)) <= 1e-9);
}

function captureAssetReceipts(event: SparkPresentedFrameEvent): Record<string, unknown>[] {
  const receipts: Record<string, unknown>[] = [];
  event.scene.traverse((object) => {
    if (!(object instanceof SplatMesh)) return;
    const identity = object.userData[SPARK_CAPTURE_USER_DATA_KEY] as Record<string, unknown> | undefined;
    if (identity === undefined) {
      throw new Error("The scene contains a splat mesh outside the frozen candidate.");
    }
    object.updateMatrixWorld(true);
    receipts.push({
      ...identity,
      meshUuid: object.uuid,
      splatCount: object.numSplats,
      initialized: object.isInitialized,
      visible: isActuallyVisible(object),
      opacity: object.opacity,
      maxSh: object.maxSh,
      enableLod: object.enableLod ?? false,
      matrixWorld: Array.from(object.matrixWorld.elements),
    });
  });
  return receipts.sort((left, right) => String(left.requestPath).localeCompare(String(right.requestPath)));
}

function assertAssets(
  receipts: readonly Record<string, unknown>[],
  configuration: ReceptionCaptureConfiguration,
): void {
  if (receipts.length !== configuration.assets.length) throw new Error("Active splat source count is wrong.");
  let total = 0;
  receipts.forEach((receipt, index) => {
    const expected = [...configuration.assets]
      .sort((left, right) => left.requestPath.localeCompare(right.requestPath))[index];
    if (expected === undefined || receipt.sourceId !== expected.sourceId
      || receipt.requestPath !== expected.requestPath || receipt.sha256 !== expected.sha256
      || receipt.sizeBytes !== expected.sizeBytes || receipt.candidateId !== configuration.candidateId
      || receipt.renderProfileId !== RECEPTION_CAPTURE_BINDING_MANIFEST.viewerProfile.spark.id
      || receipt.initialized !== true
      || receipt.visible !== true || receipt.opacity !== 1 || receipt.maxSh !== 3
      || receipt.enableLod !== false || !Number.isInteger(receipt.splatCount)
      || Number(receipt.splatCount) <= 0
      || !numericArrayClose(
        receipt.matrixWorld,
        RECEPTION_CAPTURE_BINDING_MANIFEST.viewerProfile.expectedSplatMeshMatrixWorld,
      )) {
      throw new Error("An active splat mesh does not match the frozen candidate.");
    }
    total += Number(receipt.splatCount);
  });
  if (total !== configuration.expectedSplatCount) throw new Error("Active splat total is wrong.");
}

function webGlText(
  context: WebGLRenderingContext | WebGL2RenderingContext,
  parameter: number,
): string {
  const value: unknown = context.getParameter(parameter);
  return typeof value === "string" ? value : String(value);
}

function graphicsIdentity(
  context: WebGLRenderingContext | WebGL2RenderingContext,
): Record<string, string> {
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  return {
    browserUserAgent: navigator.userAgent,
    webglVersion: webGlText(context, context.VERSION),
    webglShadingLanguageVersion: webGlText(context, context.SHADING_LANGUAGE_VERSION),
    webglVendor: webGlText(context, debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR),
    webglRenderer: webGlText(context, debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
  };
}

function rendererRecord(event: SparkPresentedFrameEvent): Record<string, unknown> {
  const spark = event.sparkRenderer;
  const context = event.renderer.getContext();
  return {
    ...graphicsIdentity(context),
    threeFrame: event.renderer.info.render.frame,
    sparkLastFrame: spark.lastFrame,
    sparkActiveSplats: spark.activeSplats,
    drawingBufferWidth: event.renderer.domElement.width,
    drawingBufferHeight: event.renderer.domElement.height,
    effectiveDpr: event.renderer.getPixelRatio(),
    outputColorSpace: event.renderer.outputColorSpace,
    toneMapping: event.renderer.toneMapping,
    toneMappingExposure: event.renderer.toneMappingExposure,
    antialias: context.getContextAttributes()?.antialias ?? null,
    alpha: context.getContextAttributes()?.alpha ?? null,
    premultipliedAlpha: context.getContextAttributes()?.premultipliedAlpha ?? null,
    contextLost: context.isContextLost(),
    sparkSorting: spark.sorting,
    sparkEnableLod: spark.enableLod,
    sparkRenderSize: spark.renderSize.toArray(),
  };
}

function assertActualRendererProfile(event: SparkPresentedFrameEvent): void {
  const expectedCanvas = RECEPTION_CAPTURE_BINDING_MANIFEST.viewerProfile.canvas;
  const attributes = event.renderer.getContext().getContextAttributes();
  if (attributes?.antialias !== expectedCanvas.antialias
    || attributes.alpha !== expectedCanvas.alpha
    || attributes.premultipliedAlpha !== expectedCanvas.premultipliedAlpha
    || event.renderer.outputColorSpace !== expectedCanvas.outputColorSpace
    || event.renderer.toneMapping !== RECEPTION_CAPTURE_BINDING_MANIFEST.toneMap.threeCode
    || event.renderer.toneMappingExposure !== expectedCanvas.toneMappingExposure) {
    throw new Error("The active Three renderer differs from the frozen profile.");
  }
  const spark = event.sparkRenderer;
  const actual: Record<string, unknown> = {
    encodeLinear: spark.encodeLinear, autoUpdate: spark.autoUpdate, preUpdate: spark.preUpdate,
    maxStdDev: spark.maxStdDev, minPixelRadius: spark.minPixelRadius,
    maxPixelRadius: spark.maxPixelRadius, minAlpha: spark.minAlpha,
    enable2DGS: spark.enable2DGS, preBlurAmount: spark.preBlurAmount,
    blurAmount: spark.blurAmount, focalDistance: spark.focalDistance,
    apertureAngle: spark.apertureAngle, falloff: spark.falloff, clipXY: spark.clipXY,
    focalAdjustment: spark.focalAdjustment, sortRadial: spark.sortRadial,
    minSortIntervalMs: spark.minSortIntervalMs, enableLod: spark.enableLod,
    premultipliedAlpha: spark.premultipliedAlpha, transparent: spark.material.transparent,
    depthTest: spark.material.depthTest, depthWrite: spark.material.depthWrite,
  };
  const expected = RECEPTION_CAPTURE_BINDING_MANIFEST.viewerProfile.spark.renderer;
  if (Object.keys(expected).some((key) => actual[key] !== expected[key as keyof typeof expected])) {
    throw new Error("The active Spark renderer differs from the frozen profile.");
  }
}

function cameraRecord(event: SparkPresentedFrameEvent): Record<string, unknown> {
  event.camera.updateMatrixWorld(true);
  return {
    positionMetres: event.camera.position.toArray(),
    quaternion: event.camera.quaternion.toArray(),
    worldMatrix: Array.from(event.camera.matrixWorld.elements),
    worldToCamera: Array.from(event.camera.matrixWorldInverse.elements),
    projectionMatrix: "projectionMatrix" in event.camera
      ? Array.from(event.camera.projectionMatrix.elements)
      : [],
  };
}

export function flipRgbaRows(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4;
  if (source.length !== rowBytes * height) throw new Error("Framebuffer byte count is wrong.");
  const result = new Uint8Array(source.length);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = (height - row - 1) * rowBytes;
    result.set(source.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return result;
}

function readPresentedPixels(event: SparkPresentedFrameEvent): Uint8Array {
  const renderer = event.renderer;
  if (renderer.getRenderTarget() !== null) throw new Error("Capture did not reach the presented framebuffer.");
  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext) || context.isContextLost()) {
    throw new Error("A live WebGL2 context is required.");
  }
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const pixels = new Uint8Array(width * height * 4);
  context.finish();
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  if (context.getError() !== context.NO_ERROR) throw new Error("Framebuffer read failed.");
  return flipRgbaRows(pixels, width, height);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function finishCapture(
  base: Omit<ReceptionCaptureResult, "framebufferPixelSha256" | "rendererFrameDigest" | "framebufferRgbaBase64">,
  pixels: Uint8Array,
): Promise<ReceptionCaptureResult> {
  const framebufferPixelSha256 = await sha256Bytes(pixels);
  const rendererFrameDigest = receptionFrameDigest({ ...base, framebufferPixelSha256 });
  return {
    ...base,
    framebufferPixelSha256,
    rendererFrameDigest,
    framebufferRgbaBase64: bytesToBase64(pixels),
  };
}

async function completePendingCapture(
  pending: { current: PendingCapture | null },
  active: PendingCapture,
  base: Omit<ReceptionCaptureResult, "framebufferPixelSha256" | "rendererFrameDigest" | "framebufferRgbaBase64">,
  pixels: Uint8Array,
): Promise<void> {
  try {
    const result = await finishCapture(base, pixels);
    assertReceptionCaptureWithinDeadline(active.startedAtMs);
    if (!releasePendingCapture(pending, active)) return;
    active.resolve(result);
  } catch (error: unknown) {
    if (!releasePendingCapture(pending, active)) return;
    active.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function frameBase(
  event: SparkPresentedFrameEvent,
  configuration: ReceptionCaptureConfiguration,
  request: ReceptionCaptureRequest,
  sessionId: string,
  sequence: number,
  receipts: readonly Record<string, unknown>[],
): Omit<ReceptionCaptureResult, "framebufferPixelSha256" | "rendererFrameDigest" | "framebufferRgbaBase64"> {
  const loadedSplatCount = receipts.reduce((total, receipt) => total + Number(receipt.splatCount), 0);
  return {
    schemaVersion: RECEPTION_CAPTURE_SCHEMA_VERSION,
    protocolDigest: request.protocolDigest,
    challengeNonce: request.challengeNonce,
    documentSessionId: sessionId,
    renderSequence: sequence,
    presentedFrameId: `r3f-${sessionId.slice(0, 16)}-${String(sequence)}`,
    candidateId: configuration.candidateId,
    viewId: configuration.viewId,
    assetSetSha256: configuration.assetSetSha256,
    assetReceipts: receipts,
    profileId: configuration.profileId,
    loadedSourceCount: receipts.length,
    loadedSplatCount,
    rendererBinding: configuration.rendererBinding,
    camera: cameraRecord(event),
    renderer: rendererRecord(event),
  };
}

interface ReadyCaptureFrame {
  readonly pixels: Uint8Array;
  readonly receipts: readonly Record<string, unknown>[];
}

function readReadyCaptureFrame(
  event: SparkPresentedFrameEvent,
  configuration: ReceptionCaptureConfiguration,
  active: PendingCapture,
  requestNext: () => void,
): ReadyCaptureFrame | null {
  assertReceptionCaptureWithinDeadline(active.startedAtMs);
  assertActualRendererProfile(event);
  const receipts = captureAssetReceipts(event);
  assertAssets(receipts, configuration);
  const observed = rendererRecord(event);
  const activeSplats = observed.sparkActiveSplats;
  if (observed.contextLost === true) throw new Error("The live renderer context was lost.");
  if (!Number.isInteger(activeSplats) || Number(activeSplats) < 0
    || Number(activeSplats) > configuration.expectedSplatCount) {
    throw new Error("Spark reported an impossible visible-splat count.");
  }
  const stable = active.lastActiveSplatCount === activeSplats;
  active.lastActiveSplatCount = Number(activeSplats);
  if (observed.sparkSorting === false && Number(activeSplats) > 0 && stable) {
    const pixels = readPresentedPixels(event);
    assertReceptionCaptureWithinDeadline(active.startedAtMs);
    return { pixels, receipts };
  }
  active.attempts += 1;
  if (active.attempts >= 3_600) {
    throw new Error("Spark did not settle on the frozen candidate within 60 seconds.");
  }
  requestAnimationFrame(requestNext);
  return null;
}

function usePresentedFrameHandler(
  configuration: ReceptionCaptureConfiguration | null,
  pending: { current: PendingCapture | null },
  invalidate: { current: (() => void) | null },
  sessionId: { current: string },
  sequence: { current: number },
): (event: SparkPresentedFrameEvent) => void {
  return useCallback((event: SparkPresentedFrameEvent) => {
    const active = pending.current;
    if (active === null || active.finishing || configuration === null) return;
    try {
      const ready = readReadyCaptureFrame(
        event,
        configuration,
        active,
        () => invalidate.current?.(),
      );
      if (ready === null) return;
      active.finishing = true;
      sequence.current += 1;
      const base = frameBase(
        event, configuration, active.request, sessionId.current, sequence.current, ready.receipts,
      );
      void completePendingCapture(pending, active, base, ready.pixels);
    } catch (error: unknown) {
      releasePendingCapture(pending, active);
      active.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }, [configuration, invalidate, pending, sequence, sessionId]);
}

function useReceptionCaptureApi(
  configuration: ReceptionCaptureConfiguration | null,
  pending: { current: PendingCapture | null },
  invalidate: { current: (() => void) | null },
): void {
  useEffect(() => {
    if (configuration === null) return;
    const api: ReceptionCaptureApi = {
      capture: (raw) => new Promise((resolve, reject) => {
        let active: PendingCapture | null = null;
        try {
          if (pending.current !== null) throw new Error("A capture is already in progress.");
          if (invalidate.current === null) throw new Error("The renderer is not ready.");
          const request = validateReceptionCaptureRequest(raw, configuration.captureNonce);
          active = {
            request,
            resolve,
            reject,
            attempts: 0,
            finishing: false,
            lastActiveSplatCount: null,
            startedAtMs: performance.now(),
            cancelDeadline: () => undefined,
          };
          pending.current = active;
          active.cancelDeadline = scheduleReceptionCaptureDeadline(() => {
            if (!releasePendingCapture(pending, active as PendingCapture)) return;
            reject(new Error("Spark did not present a settled frame within 60 seconds."));
          });
          invalidate.current();
        } catch (error: unknown) {
          if (active !== null) releasePendingCapture(pending, active);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    };
    window.__venviewerCaptureV1 = api;
    return () => {
      if (window.__venviewerCaptureV1 === api) delete window.__venviewerCaptureV1;
      const active = pending.current;
      if (active !== null && releasePendingCapture(pending, active)) {
        active.reject(new Error("Capture page closed before the frame was presented."));
      }
    };
  }, [configuration]);
}

export function useReceptionCaptureAdapter(
  configuration: ReceptionCaptureConfiguration | null,
): {
  readonly onPresentedFrame: (event: SparkPresentedFrameEvent) => void;
  readonly onInvalidatorReady: (invalidate: (() => void) | null) => void;
} {
  const pending = useRef<PendingCapture | null>(null);
  const invalidate = useRef<(() => void) | null>(null);
  const sessionId = useRef(randomSessionId());
  const sequence = useRef(0);

  const onInvalidatorReady = useCallback((next: (() => void) | null) => {
    invalidate.current = next;
  }, []);
  const onPresentedFrame = usePresentedFrameHandler(
    configuration, pending, invalidate, sessionId, sequence,
  );
  useReceptionCaptureApi(configuration, pending, invalidate);
  return { onPresentedFrame, onInvalidatorReady };
}

export function ReceptionCaptureInvalidator({
  onReady,
}: {
  readonly onReady: (invalidate: (() => void) | null) => void;
}): null {
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    onReady(invalidate);
    return () => {
      onReady(null);
    };
  }, [invalidate, onReady]);
  return null;
}
