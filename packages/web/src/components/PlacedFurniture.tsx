import { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CanvasTexture, DoubleSide, Group, LinearFilter, SRGBColorSpace } from "three";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import type { CatalogueItem } from "../lib/catalogue.js";
import { toRenderSpace } from "../constants/scale.js";
import { SELECTION_COLOR } from "../lib/selection.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { TableClothMesh } from "./meshes/TableClothMesh.js";
import { AnimatedTableCloth } from "./meshes/AnimatedTableCloth.js";
import { TableSettingMesh } from "./meshes/TableSettingMesh.js";
import { sectionClipPlanes } from "./SectionPlane.js";
import { ConstraintViolationSkin } from "./ConstraintViolationSkin.js";
import { getGroupMemberIds, getPlacementViolations } from "../lib/placement.js";
import type { PlacedItem } from "../lib/placement.js";
import { TABLE_CLOTH_COLORS, tableGroupedChairCount } from "../lib/table-dressing.js";

// ---------------------------------------------------------------------------
// PlacedFurniture — renders all placed furniture items with selection highlight
// ---------------------------------------------------------------------------

function selectionBoxArgs(item: { width: number; height: number; depth: number }): [number, number, number] {
  return [
    toRenderSpace(item.width) + 0.05,
    item.height + 0.05,
    toRenderSpace(item.depth) + 0.05,
  ];
}

function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  basePx: number,
  minPx: number,
  weight = 880,
): number {
  let size = basePx;
  while (size > minPx) {
    ctx.font = `${String(weight)} ${String(size)}px Inter, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 4;
  }
  ctx.font = `${String(weight)} ${String(minPx)}px Inter, Arial, sans-serif`;
  return minPx;
}

interface NameplateTextureOptions {
  readonly cameraEnabled: boolean;
  readonly groupedSeatCount?: number;
}

function createNameplateTexture(
  label: string,
  item: CatalogueItem,
  options: NameplateTextureOptions,
): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 880;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  const isTable = item.category === "table";
  const eyebrow = isTable ? "TABLE" : item.category === "chair" ? "SEAT" : "ITEM";
  const display = label.trim().slice(0, 80);
  const detailLines = nameplateDetailLines(item, options);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = "rgba(0, 0, 0, 0.52)";
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 24;

  const bg = ctx.createLinearGradient(46, 52, 1518, 782);
  bg.addColorStop(0, "rgba(10, 10, 9, 0.99)");
  bg.addColorStop(0.52, "rgba(24, 21, 17, 0.975)");
  bg.addColorStop(1, "rgba(8, 8, 7, 0.99)");
  ctx.fillStyle = bg;
  roundedRect(ctx, 46, 52, 1508, 724, 76);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const sheen = ctx.createLinearGradient(46, 52, 1518, 776);
  sheen.addColorStop(0, "rgba(255, 234, 160, 0.16)");
  sheen.addColorStop(0.42, "rgba(255, 255, 255, 0.015)");
  sheen.addColorStop(0.78, "rgba(219, 173, 65, 0.14)");
  sheen.addColorStop(1, "rgba(255, 240, 184, 0.1)");
  ctx.fillStyle = sheen;
  roundedRect(ctx, 78, 84, 1444, 660, 58);
  ctx.fill();

  const gradient = ctx.createLinearGradient(42, 46, 1494, 402);
  gradient.addColorStop(0, "rgba(255, 229, 142, 1)");
  gradient.addColorStop(0.32, "rgba(151, 105, 30, 0.72)");
  gradient.addColorStop(0.68, "rgba(235, 192, 80, 0.88)");
  gradient.addColorStop(1, "rgba(255, 226, 134, 1)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 10;
  roundedRect(ctx, 46, 52, 1508, 724, 76);
  ctx.stroke();

  ctx.fillStyle = options.cameraEnabled ? "rgba(76, 205, 255, 0.22)" : "rgba(232, 189, 78, 0.18)";
  roundedRect(ctx, 102, 126, 96, 410, 42);
  ctx.fill();
  ctx.strokeStyle = options.cameraEnabled ? "rgba(111, 221, 255, 0.86)" : "rgba(232, 189, 78, 0.76)";
  ctx.lineWidth = 5;
  roundedRect(ctx, 102, 126, 96, 410, 42);
  ctx.stroke();
  ctx.fillStyle = options.cameraEnabled ? "rgba(151, 230, 255, 0.96)" : "rgba(247, 206, 103, 0.95)";
  ctx.beginPath();
  ctx.arc(150, 190, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(142, 244, 16, 210);

  ctx.fillStyle = "rgba(232, 189, 78, 0.96)";
  ctx.font = "900 58px Inter, Arial, sans-serif";
  ctx.letterSpacing = "9px";
  ctx.fillText(eyebrow, 246, 170);

  ctx.fillStyle = "#fff3d2";
  fitCanvasText(ctx, display, 1178, item.category === "chair" ? 178 : 188, 92);
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 9;
  ctx.fillText(display, 244, 344);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = "rgba(255, 225, 140, 0.28)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(244, 398);
  ctx.lineTo(1424, 398);
  ctx.stroke();

  ctx.font = "760 48px Inter, Arial, sans-serif";
  ctx.fillStyle = "rgba(255, 249, 229, 0.92)";
  for (let i = 0; i < detailLines.length; i += 1) {
    const y = 474 + i * 82;
    ctx.fillStyle = i === 0 ? "rgba(255, 249, 229, 0.96)" : "rgba(226, 218, 199, 0.88)";
    ctx.beginPath();
    ctx.arc(260, y - 15, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(detailLines[i] ?? "", 292, y);
  }

  if (options.cameraEnabled) {
    ctx.fillStyle = "rgba(77, 205, 255, 0.14)";
    roundedRect(ctx, 1058, 612, 366, 76, 32);
    ctx.fill();
    ctx.strokeStyle = "rgba(117, 224, 255, 0.62)";
    ctx.lineWidth = 3;
    roundedRect(ctx, 1058, 612, 366, 76, 32);
    ctx.stroke();
    ctx.fillStyle = "rgba(189, 241, 255, 0.96)";
    ctx.font = "850 34px Inter, Arial, sans-serif";
    ctx.fillText("CAMERA POV SAVED", 1092, 660);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function nameplateDetailLines(item: CatalogueItem, options: NameplateTextureOptions): readonly string[] {
  const lines: string[] = [];
  if (item.category === "table") {
    if (options.groupedSeatCount !== undefined && options.groupedSeatCount > 0) {
      lines.push(`${String(options.groupedSeatCount)} grouped seats`);
    } else if (item.tableShape === "round") {
      lines.push("Round table");
    } else {
      lines.push("Table placement");
    }
    lines.push("Planner label");
  } else if (item.category === "chair") {
    lines.push(item.name);
    lines.push("Seat assignment");
  } else {
    lines.push(item.name);
    lines.push("Planner object");
  }

  if (options.cameraEnabled) lines.push("Camera point of view active");
  return lines.slice(0, 3);
}

function rotateOffset(dx: number, dz: number, rotationY: number): readonly [number, number] {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return [dx * cos + dz * sin, -dx * sin + dz * cos];
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function FurnitureNamePlate({
  label,
  item,
  position,
  rotationY,
  cameraEnabled,
  groupedSeatCount,
}: {
  readonly label: string;
  readonly item: CatalogueItem;
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
  readonly cameraEnabled: boolean;
  readonly groupedSeatCount?: number;
}): React.ReactElement | null {
  const groupRef = useRef<Group>(null);
  const { camera } = useThree();
  const texture = useMemo(
    () => createNameplateTexture(label, item, { cameraEnabled, groupedSeatCount }),
    [cameraEnabled, groupedSeatCount, item, label],
  );

  useFrame(() => {
    if (groupRef.current !== null) {
      groupRef.current.lookAt(camera.position);
    }
  });

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  if (texture === null) return null;

  const width = item.category === "table"
    ? Math.max(7.2, toRenderSpace(item.width) * 3.2)
    : Math.max(4.8, toRenderSpace(item.width) * 6.6);
  const height = item.category === "table"
    ? Math.max(3.9, toRenderSpace(item.depth) * 1.48)
    : 2.7;
  const yOffset = item.category === "chair" ? item.height + 1.25 : item.height + 1.35;
  const tableOffset = Math.max(2.35, toRenderSpace(item.width) * 0.72);
  const chairOffset = Math.max(0.96, toRenderSpace(item.depth) * 1.6);
  const [offsetX, offsetZ] = item.category === "table"
    ? rotateOffset(tableOffset, -tableOffset * 0.32, rotationY)
    : rotateOffset(0, -chairOffset, rotationY);

  return (
    <group
      ref={groupRef}
      name="item-nameplate"
      position={[position[0] + offsetX, position[1] + yOffset, position[2] + offsetZ]}
      rotation={[0, rotationY, 0]}
    >
      <mesh renderOrder={cameraEnabled ? 21 : 20}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={texture}
          side={DoubleSide}
          transparent
          opacity={cameraEnabled ? 1 : 0.96}
          depthTest={false}
          depthWrite={false}
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>
      <mesh
        name="item-nameplate-anchor-dot"
        position={[-width * 0.48, -height * 0.44, 0.02]}
        renderOrder={cameraEnabled ? 22 : 21}
      >
        <circleGeometry args={[0.13, 32]} />
        <meshBasicMaterial
          color={cameraEnabled ? "#8ee8ff" : "#f0ca66"}
          transparent
          opacity={0.92}
          depthTest={false}
          depthWrite={false}
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>
    </group>
  );
}

function CameraReferenceGlow({
  item,
  position,
  active,
}: {
  readonly item: CatalogueItem;
  readonly position: readonly [number, number, number];
  readonly active: boolean;
}): React.ReactElement {
  const radius = Math.max(toRenderSpace(item.width), toRenderSpace(item.depth)) * 0.66;
  return (
    <group name="camera-reference-glow" position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} renderOrder={7}>
        <torusGeometry args={[radius, active ? 0.035 : 0.024, 12, 72]} />
        <meshBasicMaterial
          color={active ? "#ffe28a" : "#c9a84c"}
          transparent
          opacity={active ? 0.86 : 0.48}
          depthTest={false}
          depthWrite={false}
          clippingPlanes={sectionClipPlanes}
        />
      </mesh>
      <pointLight
        color="#f2c75e"
        intensity={active ? 0.72 : 0.34}
        distance={2.8}
        decay={2}
        position={[0, Math.max(0.5, item.height + 0.35), 0]}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Per-item child wrapped in React.memo. Punch list #15: previously the parent
// .map() reconstructed all N JSX subtrees on every store update because the
// parent component itself re-rendered. Zustand preserves object identity for
// unchanged items in `placedItems.map((item) => item.id === id ? {...} : item)`,
// so memo's default shallow prop comparison correctly skips ~(N-1) of N
// children when one item changes. selectionBoxArgs is wrapped in useMemo so
// the BoxGeometry's `args` reference stays stable across re-renders within a
// single child — without it, R3F would dispose and reallocate the GPU buffer
// on every drag frame for every selected item.
// ---------------------------------------------------------------------------

interface PlacedFurnitureItemProps {
  readonly placed: PlacedItem;
  readonly isSelected: boolean;
  readonly isAnimating: boolean;
  readonly hasCameraReference: boolean;
  readonly isActiveCameraReference: boolean;
  readonly hasConstraintViolation: boolean;
  readonly tableSettingCount?: number;
  readonly onAnimationComplete: (id: string) => void;
}

const PlacedFurnitureItem = memo(function PlacedFurnitureItem({
  placed,
  isSelected,
  isAnimating,
  hasCameraReference,
  isActiveCameraReference,
  hasConstraintViolation,
  tableSettingCount,
  onAnimationComplete,
}: PlacedFurnitureItemProps): React.ReactElement | null {
  const catalogueItem = getCatalogueItem(placed.catalogueItemId);

  // useMemo MUST be called before any early return so the hook order is
  // stable across renders (rules-of-hooks). When catalogueItem is undefined
  // the tuple is unused; the early return below short-circuits the render.
  const memoizedSelectionArgs = useMemo(
    (): [number, number, number] => (
      catalogueItem !== undefined ? selectionBoxArgs(catalogueItem) : [0, 0, 0]
    ),
    [catalogueItem],
  );

  if (catalogueItem === undefined) return null;

  const isClothedTable = placed.clothed && catalogueItem.category === "table";
  const clothStyle = placed.clothStyle ?? "black";
  const clothColor = TABLE_CLOTH_COLORS[clothStyle];
  const hasDinnerSetting = placed.tableSetting === "dinner" && catalogueItem.category === "table";
  const displayLabel = (placed.label ?? "").trim();
  const itemPosition = [placed.x, placed.y, placed.z] as const;

  return (
    <group name={`furniture-${placed.id}`}>
      {/* Table always visible — cloth drapes over it */}
      <FurnitureProxy
        item={catalogueItem}
        position={[placed.x, placed.y, placed.z]}
        rotationY={placed.rotationY}
        name={`furniture-${placed.id}-mesh`}
      />

      {hasCameraReference && (
        <CameraReferenceGlow
          item={catalogueItem}
          position={itemPosition}
          active={isActiveCameraReference}
        />
      )}

      {/* Animated unfurl for newly clothed tables */}
      {isClothedTable && isAnimating && (
        <group
          position={[placed.x, placed.y, placed.z]}
          rotation={[0, placed.rotationY, 0]}
        >
          <AnimatedTableCloth
            tableItem={catalogueItem}
            colorOverride={clothColor}
            onComplete={() => { onAnimationComplete(placed.id); }}
          />
        </group>
      )}

      {/* Static cloth for settled tables */}
      {isClothedTable && !isAnimating && (
        <group
          position={[placed.x, placed.y, placed.z]}
          rotation={[0, placed.rotationY, 0]}
        >
          <TableClothMesh tableItem={catalogueItem} colorOverride={clothColor} />
        </group>
      )}

      {hasDinnerSetting && (
        <group
          position={[placed.x, placed.y, placed.z]}
          rotation={[0, placed.rotationY, 0]}
        >
          <TableSettingMesh tableItem={catalogueItem} settingsCount={tableSettingCount} />
        </group>
      )}

      {/* Selection wireframe */}
      {isSelected && (
        <mesh
          position={[placed.x, placed.y + catalogueItem.height / 2, placed.z]}
          rotation={[0, placed.rotationY, 0]}
        >
          <boxGeometry args={memoizedSelectionArgs} />
          <meshBasicMaterial
            color={SELECTION_COLOR}
            wireframe
            transparent
            opacity={0.8}
            clippingPlanes={sectionClipPlanes}
          />
        </mesh>
      )}

      {displayLabel.length > 0 && (
        <FurnitureNamePlate
          label={displayLabel}
          item={catalogueItem}
          position={itemPosition}
          rotationY={placed.rotationY}
          cameraEnabled={hasCameraReference}
          groupedSeatCount={tableSettingCount}
        />
      )}

      {hasConstraintViolation && (
        <group position={[placed.x, 0, placed.z]} rotation={[0, placed.rotationY, 0]}>
          <ConstraintViolationSkin item={catalogueItem} y={placed.y} />
        </group>
      )}
    </group>
  );
});

export function PlacedFurniture(): React.ReactElement {
  const { invalidate } = useThree();
  const placedItems = usePlacementStore((s) => s.placedItems);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const bookmarks = useBookmarkStore((s) => s.bookmarks);
  const activeReferenceId = useBookmarkStore((s) => s.activeReferenceId);
  const roomDims = useRoomDimensionsStore((s) => s.dimensions);

  // Track which items are currently animating their cloth unfurl
  const [animatingIds, setAnimatingIds] = useState<ReadonlySet<string>>(new Set());
  const prevClothedRef = useRef<ReadonlyMap<string, string>>(new Map());

  // Detect newly clothed items to trigger animation.
  // Avoids allocating intermediate Sets on every render — only builds new
  // Sets when an item actually becomes clothed for the first time.
  useEffect(() => {
    const prev = prevClothedRef.current;
    let newlyClothed: string[] | null = null;
    const nextClothed = new Map<string, string>();

    for (const item of placedItems) {
      if (item.clothed) {
        const key = item.clothStyle ?? "black";
        nextClothed.set(item.id, key);
        if (prev.get(item.id) !== key) {
          (newlyClothed ??= []).push(item.id);
        }
      }
    }

    prevClothedRef.current = nextClothed;

    if (newlyClothed !== null) {
      setAnimatingIds((cur) => {
        const next = new Set(cur);
        for (const id of newlyClothed) next.add(id);
        return next;
      });
    }
  }, [placedItems]);

  const handleAnimationComplete = useCallback((id: string) => {
    setAnimatingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    invalidate();
  }, [invalidate]);

  const cameraReferenceItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bookmark of bookmarks) {
      const placedItemId = bookmark.reference?.placedItemId;
      if (bookmark.kind === "reference" && typeof placedItemId === "string" && placedItemId.length > 0) {
        ids.add(placedItemId);
      }
    }
    return ids;
  }, [bookmarks]);

  const activeReferenceItemId = useMemo(() => {
    if (activeReferenceId === null) return null;
    const bookmark = bookmarks.find((candidate) => candidate.id === activeReferenceId);
    const placedItemId = bookmark?.reference?.placedItemId;
    return typeof placedItemId === "string" && placedItemId.length > 0 ? placedItemId : null;
  }, [activeReferenceId, bookmarks]);

  const constraintViolationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const placed of placedItems) {
      const item = getCatalogueItem(placed.catalogueItemId);
      if (item === undefined) continue;
      const excludeIds = getGroupMemberIds(placed.id, placedItems);
      const violations = getPlacementViolations(
        placed.x,
        placed.z,
        item,
        placed.rotationY,
        placedItems,
        excludeIds,
        placed.y,
        roomDims,
      );
      if (violations.length > 0) ids.add(placed.id);
    }
    return ids;
  }, [placedItems, roomDims]);

  const tableSettingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const placed of placedItems) {
      const count = tableGroupedChairCount(placedItems, placed);
      if (count !== undefined) counts.set(placed.id, count);
    }
    return counts;
  }, [placedItems]);

  return (
    <group name="placed-furniture">
      {placedItems.map((placed) => (
        <PlacedFurnitureItem
          key={placed.id}
          placed={placed}
          isSelected={selectedIds.has(placed.id)}
          isAnimating={animatingIds.has(placed.id)}
          hasCameraReference={cameraReferenceItemIds.has(placed.id)}
          isActiveCameraReference={activeReferenceItemId === placed.id}
          hasConstraintViolation={constraintViolationIds.has(placed.id)}
          tableSettingCount={tableSettingCounts.get(placed.id)}
          onAnimationComplete={handleAnimationComplete}
        />
      ))}
    </group>
  );
}
