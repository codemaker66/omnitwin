import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { BufferAttribute, BufferGeometry, Object3D, Vector3, type Group } from "three";
import type { SpaceDimensions } from "@omnitwin/types";
import { getCatalogueItem, type CatalogueItem } from "../lib/catalogue.js";
import {
  REFUSAL_CHIP_DELAY_MS,
  createGhostWorld,
  ghostTagWords,
  refusalChip,
  refusalSubLine,
  type GhostVerdict,
  type GhostWorld,
} from "../lib/ghost-truth.js";
import { judgeCardAt, settledStamp } from "../lib/place-in-hand.js";
import type { PlacedItem } from "../lib/placement.js";
import { plannerFeatureEnabled } from "../lib/planner-features.js";
import { describeCard, seatsInHand, stampSetup, type CardParams } from "../lib/setup-cards.js";
import { useGhostVerdictStore } from "../stores/ghost-verdict-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { ConstraintViolationSkin } from "./ConstraintViolationSkin.js";
import { FurnitureProxy } from "./FurnitureProxy.js";
import { MarkLabel } from "./planner-chrome/Surfaces.js";
import "./ghost-set.css";

// ---------------------------------------------------------------------------
// GhostSet — the truthful ghost (card-dock spec §7.2–7.5, Q-05): the whole
// set a card will set down (setup-cards placesAsCard), judged behind
// truthfulGhost (without it, the set as set down, claiming nothing), worked
// out by the same function as the commit (lib/place-in-hand judgeCardAt), so
// what it shows is what is set down: turned as the piece in hand is turned,
// each piece at the height of the surface under it, judged with every body
// once a frame, only when its pose, its turn or the room has changed.
//
//   fits      drawn where the pointer puts it; its tag reads "fits"
//   pushed    drawn where the judge pushes it, up to 0.15 m, a hairline back
//             to the pointer; "fits · moved 0.12 m"
//   refused   tinted and hatched; every piece in the way outlined in brick;
//             after 80 ms of refusal the chip says why; the cursor refuses
//
// The set moves by ref, so a pointer move commits nothing to React; only a
// change of state, words or obstacles does, and on that frame the move waits
// for the commit, so the tint and the place change together. The last verdict
// goes to the ghost verdict store, so setting the set down judges as the
// ghost did.
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

/** Where the set stands this frame: the group's place and each piece's height above it. */
interface SetPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heights: readonly number[];
}

/** Stands the set where the judge put it, each piece at the height of the surface under it. */
function standAt(set: Group | null, pieces: readonly (Object3D | null)[], at: SetPose): void {
  // Only a three object has a place (the planner's DOM tests render this tree into the page).
  if (!(set instanceof Object3D)) return;
  set.position.set(at.x, at.y, at.z);
  at.heights.forEach((height, i) => {
    const piece = pieces[i];
    if (piece instanceof Object3D) piece.position.y = height;
  });
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
  const pieceGroups = useRef<(Object3D | null)[]>([]);
  const hairline = useMemo(() => {
    const built = new BufferGeometry();
    built.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    return built;
  }, []);
  useEffect(() => () => { hairline.dispose(); }, [hairline]);
  // The set about its own origin, turned as the piece in hand is turned: the commit's stamp, less its place.
  const local = useMemo(() => stampSetup(params, { x: 0, z: 0 }, ghostRotation, ghostIds()), [params, ghostRotation]);
  const pieces = useMemo(() => local.flatMap((piece) => {
    const item = getCatalogueItem(piece.catalogueItemId);
    return item === undefined ? [] : [{ piece, item }];
  }), [local]);
  const tagHeight = useMemo(() => Math.max(0.1, ...pieces.map(({ item }) => item.height)) + TAG_CLEARANCE, [pieces]);
  const outline = useMemo(() => outlineGeometry(pieces.map(({ piece, item }) => ({ placed: piece, item }))), [pieces]);
  useEffect(() => () => { outline?.dispose(); }, [outline]);
  const [view, setView] = useState<GhostView>(() => ({ state: "fits", tag: ghostTag(params, null), chip: null, blockingIds: [] }));
  const [chipShown, setChipShown] = useState(false);
  const [announced, setAnnounced] = useState<string | null>(null);
  const judged = useRef<{ key: string; verdict: GhostVerdict | null }>({ key: "", verdict: null });
  const world = useRef<{ placedItems: readonly PlacedItem[] | null; room: SpaceDimensions | null; world: GhostWorld | null }>({ placedItems: null, room: null, world: null });
  const pending = useRef<SetPose | null>(null);

  // A new card starts with no history.
  useEffect(() => {
    judged.current = { key: "", verdict: null };
    setView({ state: "fits", tag: ghostTag(params, null), chip: null, blockingIds: [] });
    invalidate();
    return () => { useGhostVerdictStore.getState().setVerdict(null); };
  }, [params, invalidate]);

  // The chip waits 80 ms of continuous refusal, so a sweep across a table never flashes it; new
  // words within the same refusal change it in place.
  const refusing = view.state === "refused";
  useEffect(() => {
    setChipShown(false);
    setAnnounced(null);
    if (!refusing) return undefined;
    const timer = window.setTimeout(() => {
      setChipShown(true);
      invalidate();
    }, REFUSAL_CHIP_DELAY_MS);
    return () => { window.clearTimeout(timer); };
  }, [refusing, invalidate]);
  // Announced once per attempt: the reason as the chip first said it.
  useEffect(() => {
    if (chipShown && announced === null && view.chip !== null) setAnnounced(`${view.chip}. ${refusalSubLine(fromCardDrag)}`);
  }, [chipShown, announced, view.chip, fromCardDrag]);

  // The cursor refuses with the set; it goes back to the hand's crosshair only from its own refusal,
  // so a card put down leaves the cursor PlacementGhost restores.
  useEffect(() => {
    if (!refusing) return undefined;
    const canvas = gl.domElement;
    canvas.style.cursor = "not-allowed";
    return () => { if (canvas.style.cursor === "not-allowed") canvas.style.cursor = "crosshair"; };
  }, [gl, refusing]);

  // A frame that changes the ghost's state moves it with the commit that changes its look.
  useLayoutEffect(() => {
    const at = pending.current;
    if (at === null) return;
    pending.current = null;
    standAt(group.current, pieceGroups.current, at);
    invalidate();
  }, [view, invalidate]);

  useFrame(() => {
    const placement = usePlacementStore.getState();
    const pose = placement.ghostPosition;
    if (pose === null) {
      // The ghost has gone: no history for the next attempt.
      if (judged.current.verdict !== null) {
        judged.current = { key: "", verdict: null };
        useGhostVerdictStore.getState().setVerdict(null);
      }
      const set = group.current;
      if (warming && set instanceof Object3D) {
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
    const origin = { x: pose[0], z: pose[2], y: pose[1] };
    // Judged under truthfulGhost; otherwise the set stands where the commit will set it down, and claims nothing.
    const judgedCard = plannerFeatureEnabled("truthfulGhost")
      ? judgeCardAt(params, origin, placement.ghostRotation, current, judged.current.verdict?.state, ghostIds())
      : null;
    const verdict = judgedCard?.verdict ?? null;
    const standing = judgedCard?.pieces ?? settledStamp(params, origin, placement.ghostRotation, placement.placedItems, ghostIds());
    judged.current = { key, verdict };
    useGhostVerdictStore.getState().setVerdict(verdict);
    const at: SetPose = { x: pose[0] + (verdict?.dx ?? 0), y: pose[1], z: pose[2] + (verdict?.dz ?? 0), heights: standing.map((piece) => piece.y - pose[1]) };
    const line = hairline.getAttribute("position");
    if (line instanceof BufferAttribute) {
      line.setXYZ(0, pose[0], FLOOR_LINE_Y, pose[2]);
      line.setXYZ(1, at.x, FLOOR_LINE_Y, at.z);
      line.needsUpdate = true;
    }
    const next: GhostView = {
      state: verdict?.state ?? "fits",
      tag: ghostTag(params, verdict),
      chip: verdict?.state === "refused" ? refusalChip(verdict.obstacle) : null,
      blockingIds: verdict?.blockingIds ?? [],
    };
    const shown = view;
    const same = shown.state === next.state && shown.tag === next.tag && shown.chip === next.chip
      && shown.blockingIds.join("|") === next.blockingIds.join("|");
    if (same) {
      standAt(group.current, pieceGroups.current, at);
      return;
    }
    pending.current = at;
    setView(next);
  });

  const warmedSkin = refusing || warming;
  return (
    <>
      <group ref={group} scale={hasGhost ? 1 : 1e-4} visible={hasGhost || warming} name="placement-ghost-set">
        {pieces.map(({ piece, item }, i) => (
          <group
            key={piece.id}
            ref={(node) => { pieceGroups.current[i] = node; }}
            position={[piece.x, 0, piece.z]}
            rotation={[0, piece.rotationY, 0]}
          >
            <FurnitureProxy
              item={item}
              position={[0, 0, 0]}
              rotationY={0}
              opacity={refusing ? REFUSED_OPACITY : GHOST_OPACITY}
              colorOverride={refusing ? REFUSED_TINT : undefined}
              name="placement-ghost-mesh"
            />
            <group visible={warmedSkin}>
              <ConstraintViolationSkin item={item} y={0} />
            </group>
          </group>
        ))}
        {outline !== null && (
          <lineSegments geometry={outline} visible={!refusing} name="ghost-set-outline" renderOrder={2}>
            <lineBasicMaterial color={COPPER_BRIGHT} transparent opacity={0.9} depthTest={false} />
          </lineSegments>
        )}
        {hasGhost && (
          <Html position={[0, tagHeight, 0]} center zIndexRange={[30, 0]}>
            <div className="ghost-set" data-testid="ghost-set-words" data-state={view.state}>
              <div className="ghost-set__tag">
                <MarkLabel tone={refusing ? "brick" : "copper"}>{view.tag}</MarkLabel>
              </div>
              {refusing && chipShown && view.chip !== null && (
                <div className="ghost-set__chip" aria-hidden="true" data-testid="ghost-set-chip">
                  <MarkLabel tone="brick">{view.chip}</MarkLabel>
                  <div className="ghost-set__subline">
                    <MarkLabel className="ghost-set__subline-mark">{refusalSubLine(fromCardDrag)}</MarkLabel>
                  </div>
                </div>
              )}
              <span className="ghost-set__announce" role="alert">{announced ?? ""}</span>
            </div>
          </Html>
        )}
      </group>
      <lineSegments geometry={hairline} visible={hasGhost && view.state === "pushed"} name="ghost-push-hairline">
        <lineBasicMaterial color={COPPER_BRIGHT} transparent opacity={0.6} depthTest={false} />
      </lineSegments>
      {hasGhost && refusing && view.blockingIds.length > 0 && <BlockingOutlines ids={view.blockingIds} />}
    </>
  );
}
