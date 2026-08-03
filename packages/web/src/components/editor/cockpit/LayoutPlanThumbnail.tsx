import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import type {
  CanonicalLayoutSnapshotV0,
  LayoutSnapshotPlacedObject,
} from "@omnitwin/types";

interface LayoutPlanThumbnailProps {
  readonly snapshot: CanonicalLayoutSnapshotV0;
  readonly label: string;
  readonly proofKey: string;
  readonly paused?: boolean;
}
interface PlanBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const CANVAS_WIDTH = 288;
const CANVAS_HEIGHT = 112;
const PLAN_PADDING = 10;
const MAX_CACHED_THUMBNAIL_RASTERS = 24;

interface ThumbnailRasterJob {
  readonly snapshot: CanonicalLayoutSnapshotV0;
  readonly subscribers: Set<(raster: HTMLCanvasElement) => void>;
}

/** Narrow browser-canvas boundary used by the idle rasterizer and its typed tests. */
export interface TimelineThumbnailCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  readonly clearRect: (x: number, y: number, width: number, height: number) => void;
  readonly fillRect: (x: number, y: number, width: number, height: number) => void;
  readonly beginPath: () => void;
  readonly moveTo: (x: number, y: number) => void;
  readonly lineTo: (x: number, y: number) => void;
  readonly closePath: () => void;
  readonly fill: () => void;
  readonly stroke: () => void;
  readonly save: () => void;
  readonly translate: (x: number, y: number) => void;
  readonly rotate: (angle: number) => void;
  readonly ellipse: (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ) => void;
  readonly restore: () => void;
  readonly drawImage: (image: CanvasImageSource, dx: number, dy: number) => void;
}

type TimelineThumbnailContextResolver = (
  canvas: HTMLCanvasElement,
) => TimelineThumbnailCanvasContext | null;

const browserCanvasContext: TimelineThumbnailContextResolver = (canvas) => canvas.getContext("2d");
let resolveCanvasContext: TimelineThumbnailContextResolver = browserCanvasContext;

const rasterCache = new Map<string, HTMLCanvasElement>();
const rasterJobs = new Map<string, ThumbnailRasterJob>();
let scheduledIdle: number | null = null;
let scheduledFallback: number | null = null;

function bounds(snapshot: CanonicalLayoutSnapshotV0): PlanBounds {
  const outline = snapshot.venueRuntime.floorPlanOutline;
  const objectExtents = snapshot.objects.flatMap((object) => {
    const radius = Math.hypot(
      object.assetDefinition.widthM,
      object.assetDefinition.depthM,
    ) * object.scale / 2;
    return [
      { x: object.position.x - radius, z: object.position.z - radius },
      { x: object.position.x + radius, z: object.position.z + radius },
    ];
  });
  const xs = [
    ...outline.map((point) => point.x),
    ...objectExtents.map((point) => point.x),
  ];
  const zs = [
    ...outline.map((point) => point.y),
    ...objectExtents.map((point) => point.z),
  ];
  if (xs.length === 0 || zs.length === 0) {
    return {
      minX: 0,
      maxX: snapshot.venueRuntime.spaceDimensions.width,
      minZ: 0,
      maxZ: snapshot.venueRuntime.spaceDimensions.length,
    };
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function objectColour(object: LayoutSnapshotPlacedObject): string {
  switch (object.assetDefinition.category) {
    case "table": return "#d5b557";
    case "chair": return "#a5b8bc";
    case "stage": return "#b788e4";
    case "lighting": return "#67cbd3";
    case "av": return "#6fa6dd";
    case "barrier": return "#d47b69";
    default: return "#8e978f";
  }
}

export function isRoundTimelineCollision(collisionType: string): boolean {
  return collisionType === "circle" || collisionType === "cylinder";
}

function paintPlan(
  context: TimelineThumbnailCanvasContext,
  snapshot: CanonicalLayoutSnapshotV0,
): void {
  const planBounds = bounds(snapshot);
  const widthM = Math.max(0.1, planBounds.maxX - planBounds.minX);
  const depthM = Math.max(0.1, planBounds.maxZ - planBounds.minZ);
  const scale = Math.min(
    (CANVAS_WIDTH - PLAN_PADDING * 2) / widthM,
    (CANVAS_HEIGHT - PLAN_PADDING * 2) / depthM,
  );
  const offsetX = (CANVAS_WIDTH - widthM * scale) / 2;
  const offsetY = (CANVAS_HEIGHT - depthM * scale) / 2;
  const x = (metres: number): number => offsetX + (metres - planBounds.minX) * scale;
  const y = (metres: number): number => offsetY + (metres - planBounds.minZ) * scale;

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.fillStyle = "#0a0e0f";
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const outline = snapshot.venueRuntime.floorPlanOutline;
  if (outline.length > 0) {
    context.beginPath();
    outline.forEach((point, index) => {
      if (index === 0) context.moveTo(x(point.x), y(point.y));
      else context.lineTo(x(point.x), y(point.y));
    });
    context.closePath();
    context.fillStyle = "rgba(223, 205, 159, 0.055)";
    context.fill();
    context.strokeStyle = "rgba(228, 205, 139, 0.42)";
    context.lineWidth = 1;
    context.stroke();
  }

  for (const object of snapshot.objects) {
    const objectWidth = Math.max(2.5, object.assetDefinition.widthM * object.scale * scale);
    const objectDepth = Math.max(2.5, object.assetDefinition.depthM * object.scale * scale);
    context.save();
    context.translate(x(object.position.x), y(object.position.z));
    context.rotate(object.rotation.y);
    context.fillStyle = objectColour(object);
    context.globalAlpha = object.assetDefinition.category === "chair" ? 0.78 : 0.9;
    if (isRoundTimelineCollision(object.assetDefinition.collisionType)) {
      context.beginPath();
      context.ellipse(0, 0, objectWidth / 2, objectDepth / 2, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      context.fillRect(-objectWidth / 2, -objectDepth / 2, objectWidth, objectDepth);
    }
    context.restore();
  }
}

function cachedRaster(proofKey: string): HTMLCanvasElement | null {
  const raster = rasterCache.get(proofKey);
  if (raster === undefined) return null;
  rasterCache.delete(proofKey);
  rasterCache.set(proofKey, raster);
  return raster;
}

function retainRaster(proofKey: string, raster: HTMLCanvasElement): void {
  rasterCache.set(proofKey, raster);
  while (rasterCache.size > MAX_CACHED_THUMBNAIL_RASTERS) {
    const oldest = rasterCache.keys().next();
    if (oldest.done === true) break;
    rasterCache.delete(oldest.value);
  }
}

function scheduleRasterWork(): void {
  if (scheduledIdle !== null || scheduledFallback !== null || rasterJobs.size === 0) return;
  if (
    typeof window.requestIdleCallback === "function"
    && typeof window.cancelIdleCallback === "function"
  ) {
    scheduledIdle = window.requestIdleCallback((deadline) => {
      scheduledIdle = null;
      if (!deadline.didTimeout && deadline.timeRemaining() < 4) {
        scheduleRasterWork();
        return;
      }
      paintNextRasterJob();
    });
    return;
  }
  scheduledFallback = window.setTimeout(() => {
    scheduledFallback = null;
    paintNextRasterJob();
  }, 32);
}

function paintNextRasterJob(): void {
  const next = rasterJobs.entries().next();
  if (next.done === true) return;
  const [proofKey, job] = next.value;
  rasterJobs.delete(proofKey);
  const raster = document.createElement("canvas");
  raster.width = CANVAS_WIDTH;
  raster.height = CANVAS_HEIGHT;
  const context = resolveCanvasContext(raster);
  if (context !== null) {
    paintPlan(context, job.snapshot);
    retainRaster(proofKey, raster);
    for (const subscriber of job.subscribers) subscriber(raster);
  }
  scheduleRasterWork();
}

function subscribeToRaster(
  proofKey: string,
  snapshot: CanonicalLayoutSnapshotV0,
  subscriber: (raster: HTMLCanvasElement) => void,
): () => void {
  const cached = cachedRaster(proofKey);
  if (cached !== null) {
    subscriber(cached);
    return () => undefined;
  }
  const existing = rasterJobs.get(proofKey);
  const job = existing ?? { snapshot, subscribers: new Set() };
  job.subscribers.add(subscriber);
  if (existing === undefined) rasterJobs.set(proofKey, job);
  scheduleRasterWork();
  return () => {
    job.subscribers.delete(subscriber);
    if (job.subscribers.size === 0) rasterJobs.delete(proofKey);
  };
}

export function resetTimelineThumbnailRasterCacheForTests(): void {
  rasterCache.clear();
  rasterJobs.clear();
  if (scheduledIdle !== null && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(scheduledIdle);
  }
  if (scheduledFallback !== null) window.clearTimeout(scheduledFallback);
  scheduledIdle = null;
  scheduledFallback = null;
  resolveCanvasContext = browserCanvasContext;
}

export function setTimelineThumbnailCanvasContextResolverForTests(
  resolver: TimelineThumbnailContextResolver,
): void {
  resolveCanvasContext = resolver;
}

export function timelineThumbnailRasterCacheSizeForTests(): number {
  return rasterCache.size;
}

/** A truthful mini-plan rendered only from the immutable canonical room
 * outline and object payload. */
function LayoutPlanThumbnailComponent({
  snapshot,
  label,
  proofKey,
  paused = false,
}: LayoutPlanThumbnailProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const applyRaster = (raster: HTMLCanvasElement): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const context = resolveCanvasContext(canvas);
      if (context === null) return;
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.drawImage(raster, 0, 0);
      setReady(true);
    };
    const cached = cachedRaster(proofKey);
    if (cached !== null) {
      applyRaster(cached);
      return;
    }
    if (paused) return;
    return subscribeToRaster(proofKey, snapshot, applyRaster);
  }, [paused, proofKey, snapshot]);

  return (
    <canvas
      ref={canvasRef}
      className="layout-filmstrip__image"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      role={ready ? "img" : undefined}
      aria-label={ready ? `${label} canonical plan preview` : undefined}
      aria-hidden={ready ? undefined : "true"}
      data-thumbnail-ready={String(ready)}
    />
  );
}

export const LayoutPlanThumbnail = memo(LayoutPlanThumbnailComponent);
