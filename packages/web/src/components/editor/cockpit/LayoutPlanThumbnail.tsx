import { useEffect, useRef, type ReactElement } from "react";
import type {
  CanonicalLayoutSnapshotV0,
  LayoutSnapshotPlacedObject,
} from "@omnitwin/types";

interface LayoutPlanThumbnailProps {
  readonly snapshot: CanonicalLayoutSnapshotV0;
  readonly label: string;
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
  context: CanvasRenderingContext2D,
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

/** A truthful mini-plan rendered only from the immutable canonical room
 * outline and object payload. */
export function LayoutPlanThumbnail({
  snapshot,
  label,
}: LayoutPlanThumbnailProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context === null || context === undefined) return;
    paintPlan(context, snapshot);
  }, [snapshot]);

  return (
    <canvas
      ref={canvasRef}
      className="layout-filmstrip__image"
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      role="img"
      aria-label={`${label} canonical plan preview`}
    />
  );
}
