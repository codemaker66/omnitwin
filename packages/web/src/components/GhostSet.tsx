import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { BufferAttribute, BufferGeometry, Object3D, Vector3, type Group } from "three";
import type { SpaceDimensions } from "@omnitwin/types";
import { getCatalogueItem, type CatalogueItem } from "../lib/catalogue.js";
import {
  REFUSAL_CHIP_DELAY_MS,
  createGhostWorld,
  ghostTagWords,
  judgeGhost,
  refusalChip,
  refusalSubLine,
  type GhostVerdict,
  type GhostWorld,
} from "../lib/ghost-truth.js";
import type { PlacedItem } from "../lib/placement.js";
import { describeCard, seatsInHand, stampSetup, type CardParams } from "../lib/setup-cards.js";
import { useGhostVerdictStore } from "../stores/ghost-verdict-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { ConstraintViolationSkin } from "./ConstraintViolationSkin.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { MarkLabel } from "./planner-chrome/Surfaces.js";
import "./ghost-set.css";

// ---------------------------------------------------------------------------
// GhostSet — the truthful ghost (card-dock spec §7.2–7.5, Q-05; behind
// truthfulGhost and setupCards): the whole set a card will set down, judged
// with every body against the room once a frame, only when its pose, its
// turn or the room has changed.
//
//   fits      drawn where the pointer puts it; its tag reads "fits"
//   pushed    drawn where the judge pushes it, up to 0.15 m, a hairline back
//             to the pointer; "fits · moved 0.12 m"
//   refused   tinted and hatched; every piece in the way outlined in brick;
//             after 80 ms of refusal the chip says why; the cursor refuses
//
// The set moves by ref, so a pointer move commits nothing to React; only a
// change of state, words or obstacles does. The last verdict goes to the
// ghost verdict store, so setting the set down judges as the ghost did.
// ---------------------------------------------------------------------------

/** The ghost's own ids, the same every frame, so its pieces keep their React keys. */
function ghostIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `ghost-${String(next)}`;
  };
}

// The ghost material (docs/plan/02-DESIGN-LANGUAGE.md §3; card-dock spec §7.2–7.3): each piece in
// its own albedo at the house ghost opacity, the set outlined in copper-bright; refused, tinted
// toward the attention plane under the hatch, each piece in the way outlined in brick-lit.
const GHOST_OPACITY = 0.32;
const REFUSED_TINT = "#7e2d1b";
const REFUSED_OPACITY = 0.45;
const COPPER_BRIGHT = "#dca475";
const BRICK_LIT = "#ffcdb7";
const FLOOR_LINE_Y = 0.02;
const TAG_CLEARANCE = 0.35;

interface GhostView {
  readonly state: GhostVerdict["state"];
  readonly tag: string;
  readonly chip: string | null;
  readonly blockingIds: readonly string[];
}

/** The tag above the set: "Round of 10 · +10 seats ✓ fits", "Dance floor · 4.6 m square ✓ fits · moved 0.12 m". */
export function ghostTag(params: CardParams, verdict: GhostVerdict | null): string {
  const face = describeCard(params);
  const seats = seatsInHand(params);
  const detail = seats > 0 ? `+${String(seats)} seats` : face.size;
  const what = detail === "" ? face.name : `${face.name} · ${detail}`;
  if (verdict === null) return what;
  return verdict.state === "refused" ? `${what} · won't fit` : `${what} ✓ ${ghostTagWords(verdict)}`;
}

/** A placed piece's footprint on the floor, as the line segments of its outline. */
function footprintSegments(placed: PlacedItem, item: CatalogueItem): readonly number[] {
  const scale = placed.scale ?? 1;
  const hw = (item.width * scale) / 2;
  const hd = (item.depth * scale) / 2;
  const cos = Math.cos(placed.rotationY);
  const sin = Math.sin(placed.rotationY);
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx = 0, lz = 0]) => [placed.x + lx * cos + lz * sin, placed.z - lx * sin + lz * cos] as const);
  return corners.flatMap(([x, z], i) => {
    const [nx, nz] = corners[(i + 1) % corners.length] ?? [x, z];
    return [x, FLOOR_LINE_Y, z, nx, FLOOR_LINE_Y, nz];
  });
}

/** Pieces' footprints on the floor as one line geometry, or null with none. */
function outlineGeometry(pieces: readonly { readonly placed: PlacedItem; readonly item: CatalogueItem }[]): BufferGeometry | null {
  const segments = pieces.flatMap(({ placed, item }) => footprintSegments(placed, item));
  if (segments.length === 0) return null;
  const built = new BufferGeometry();
  built.setAttribute("position", new BufferAttribute(new Float32Array(segments), 3));
  return built;
}

/** Every piece in the way, outlined on the floor in brick-lit. */
function BlockingOutlines({ ids }: { readonly ids: readonly string[] }): ReactElement | null {
  const geometry = useMemo(() => {
    const placedItems = usePlacementStore.getState().placedItems;
    return outlineGeometry(ids.flatMap((id) => {
      const placed = placedItems.find((piece) => piece.id === id);
      const item = placed === undefined ? undefined : getCatalogueItem(placed.catalogueItemId);
      return placed === undefined || item === undefined ? [] : [{ placed, item }];
    }));
  }, [ids]);
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);
  if (geometry === null) return null;
  return (
    <lineSegments geometry={geometry} name="ghost-blocking-outlines" renderOrder={2}>
      <lineBasicMaterial color={BRICK_LIT} transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  );
}

export interface GhostSetProps {
  readonly params: CardParams;
  /** Drawn tiny ahead of the camera while its materials compile, before the first move. */
  readonly warming: boolean;
  /** Whether the card was dragged out (the chip's second line says what letting go does). */
  readonly fromCardDrag: boolean;
}

const _ahead = new Vector3();

export function GhostSet({ params, warming, fromCardDrag }: GhostSetProps): ReactElement {
  const { camera, gl, invalidate } = useThree();
  const ghostRotation = usePlacementStore((state) => state.ghostRotation);
  const hasGhost = usePlacementStore((state) => state.ghostPosition !== null);
  const group = useRef<Group>(null);
  const hairline = useMemo(() => {
    const built = new BufferGeometry();
    built.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    return built;
  }, []);
  useEffect(() => () => { hairline.dispose(); }, [hairline]);
  const local = useMemo(() => stampSetup(params, { x: 0, z: 0 }, 0, ghostIds()), [params]);
  const pieces = useMemo(() => local.flatMap((piece) => {
    const item = getCatalogueItem(piece.catalogueItemId);
    return item === undefined ? [] : [{ piece, item }];
  }), [local]);
  const tagHeight = useMemo(() => Math.max(0.1, ...pieces.map(({ item }) => item.height)) + TAG_CLEARANCE, [pieces]);
  const outline = useMemo(() => outlineGeometry(pieces.map(({ piece, item }) => ({ placed: piece, item }))), [pieces]);
  useEffect(() => () => { outline?.dispose(); }, [outline]);
  const [view, setView] = useState<GhostView>(() => ({ state: "fits", tag: ghostTag(params, null), chip: null, blockingIds: [] }));
  const [chipShown, setChipShown] = useState(false);
  const judged = useRef<{ key: string; verdict: GhostVerdict | null }>({ key: "", verdict: null });
  const world = useRef<{ placedItems: readonly PlacedItem[] | null; room: SpaceDimensions | null; world: GhostWorld | null }>({ placedItems: null, room: null, world: null });

  // A new card starts with no history.
  useEffect(() => {
    judged.current = { key: "", verdict: null };
    setView({ state: "fits", tag: ghostTag(params, null), chip: null, blockingIds: [] });
    invalidate();
    return () => { useGhostVerdictStore.getState().setVerdict(null); };
  }, [params, invalidate]);

  // The chip waits 80 ms of continuous refusal, so a sweep across a table never flashes it.
  useEffect(() => {
    setChipShown(false);
    if (view.state !== "refused") return undefined;
    const timer = window.setTimeout(() => {
      setChipShown(true);
      invalidate();
    }, REFUSAL_CHIP_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [view.state, view.chip, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.style.cursor = view.state === "refused" ? "not-allowed" : "crosshair";
  }, [gl, view.state]);

  useFrame(() => {
    // Only a three object has a place (the planner's DOM tests render this tree into the page).
    const set = group.current instanceof Object3D ? group.current : null;
    const placement = usePlacementStore.getState();
    const pose = placement.ghostPosition;
    if (pose === null) {
      if (warming && set !== null) {
        camera.getWorldDirection(_ahead);
        set.position.copy(camera.position).addScaledVector(_ahead, 1);
      }
      return;
    }
    const room = useRoomDimensionsStore.getState().dimensions;
    const cache = world.current;
    if (cache.placedItems !== placement.placedItems || cache.room !== room || cache.world === null) {
      world.current = { placedItems: placement.placedItems, room, world: createGhostWorld(placement.placedItems, room) };
      judged.current.key = "";
    }
    const current = world.current.world;
    const key = `${String(pose[0])}|${String(pose[2])}|${String(placement.ghostRotation)}`;
    if (current === null || key === judged.current.key) return;
    const stamp = stampSetup(params, { x: pose[0], z: pose[2], y: pose[1] }, placement.ghostRotation, ghostIds());
    const verdict = judgeGhost(stamp, current, { previous: judged.current.verdict?.state });
    judged.current = { key, verdict };
    useGhostVerdictStore.getState().setVerdict(verdict);
    set?.position.set(pose[0] + verdict.dx, pose[1], pose[2] + verdict.dz);
    const line = hairline.getAttribute("position");
    if (line instanceof BufferAttribute) {
      line.setXYZ(0, pose[0], FLOOR_LINE_Y, pose[2]);
      line.setXYZ(1, pose[0] + verdict.dx, FLOOR_LINE_Y, pose[2] + verdict.dz);
      line.needsUpdate = true;
    }
    const next: GhostView = {
      state: verdict.state,
      tag: ghostTag(params, verdict),
      chip: verdict.state === "refused" ? refusalChip(verdict.obstacle) : null,
      blockingIds: verdict.blockingIds,
    };
    setView((shown) => (shown.state === next.state && shown.tag === next.tag && shown.chip === next.chip
      && shown.blockingIds.join("|") === next.blockingIds.join("|") ? shown : next));
  });

  const refused = view.state === "refused";
  return (
    <>
      <group ref={group} rotation={[0, ghostRotation, 0]} scale={hasGhost ? 1 : 1e-4} visible={hasGhost || warming} name="placement-ghost-set">
        {pieces.map(({ piece, item }) => (
          <group key={piece.id} position={[piece.x, piece.y, piece.z]} rotation={[0, piece.rotationY, 0]}>
            {refused ? (
              <>
                <FurnitureProxy item={item} position={[0, 0, 0]} rotationY={0} opacity={REFUSED_OPACITY} colorOverride={REFUSED_TINT} name="placement-ghost-mesh" />
                <ConstraintViolationSkin item={item} y={0} />
              </>
            ) : (
              <FurnitureProxy item={item} position={[0, 0, 0]} rotationY={0} opacity={GHOST_OPACITY} name="placement-ghost-mesh" />
            )}
          </group>
        ))}
        {outline !== null && (
          <lineSegments geometry={outline} visible={!refused} name="ghost-set-outline" renderOrder={2}>
            <lineBasicMaterial color={COPPER_BRIGHT} transparent opacity={0.9} depthTest={false} />
          </lineSegments>
        )}
        {hasGhost && (
          <Html position={[0, tagHeight, 0]} center zIndexRange={[30, 0]}>
            <div className="ghost-set" data-testid="ghost-set-words" data-state={view.state}>
              <div className="ghost-set__tag">
                <MarkLabel tone={refused ? "brick" : "copper"}>{view.tag}</MarkLabel>
              </div>
              {refused && chipShown && view.chip !== null && (
                <div className="ghost-set__chip" role="alert">
                  <MarkLabel tone="brick">{view.chip}</MarkLabel>
                  <div className="ghost-set__subline">
                    <MarkLabel className="ghost-set__subline-mark">{refusalSubLine(fromCardDrag)}</MarkLabel>
                  </div>
                </div>
              )}
            </div>
          </Html>
        )}
      </group>
      <lineSegments geometry={hairline} visible={hasGhost && view.state === "pushed"} name="ghost-push-hairline">
        <lineBasicMaterial color={COPPER_BRIGHT} transparent opacity={0.6} depthTest={false} />
      </lineSegments>
      {hasGhost && refused && view.blockingIds.length > 0 && <BlockingOutlines ids={view.blockingIds} />}
    </>
  );
}
