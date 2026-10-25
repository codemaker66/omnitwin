import { Suspense, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { NeutralToneMapping, Vector3 } from "three";
import { PMREMGenerator, type RenderTarget } from "three/webgpu";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getNativeRenderer } from "../lib/native-renderer.js";
import { NativeCanvas as Canvas } from "../components/scene/NativeCanvas.js";
import { HALL_MOOD_NAMES, type HallMoodName } from "../components/grand-hall/hall-mood.js";
import { HallLightRig } from "../components/grand-hall/HallLightRig.js";
import { GrandHallModel } from "../components/grand-hall/GrandHallModel.js";
import { FULL_HALL_FINISH } from "../components/grand-hall/hall-finish.js";
import { CaptureToneMapping } from "../components/scene/CaptureToneMapping.js";
import { FurnitureProxy, standaloneFurnitureMeshUrl } from "../components/FurnitureProxy.js";
import { GltfFurniture } from "../components/meshes/GltfFurniture.js";
import { MeshErrorBoundary } from "../components/MeshErrorBoundary.js";
import { isCraftedFurnitureSlug, setupCardLook, setupCardPreviewUrl } from "../lib/crafted-furniture.js";
import { CATALOGUE_ITEMS, getCatalogueItem, getCatalogueItemBySlug, type CatalogueItem } from "../lib/catalogue.js";
import type { PlacedItem } from "../lib/placement.js";
import { footprintBounds } from "../lib/placement-edit.js";
import { setupCardLooks, stampSetup, type CardParams } from "../lib/setup-cards.js";

// Development fixture for the crafted furniture: every crafted piece beside
// the supplied model it replaces (and any supplied model not yet crafted),
// in the Grand Hall's own light, with a window bridge so headless captures
// can frame any piece exactly. `?preview=<slug>` instead shows one piece in a
// neutral studio, framed as the catalogue previews are, for rendering them;
// `?setup=<card>/<look>` shows a setup card's look the same way, and
// `?setup-looks` lists the looks. Compiled out of production builds with the
// other fixtures.

interface LabPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov?: number;
}

type Backdrop = "studio" | "hall";

declare global {
  interface Window {
    /** Set once a preview has drawn with its studio light and reflections; `error` when it never will. */
    __furniturePreview?: { readonly ready: boolean; readonly error?: string };
    /** Every setup look (`?setup-looks`): its lab address and where its picture goes. */
    __setupLooks?: readonly { readonly key: string; readonly url: string }[];
    __furnitureLab?: {
      readonly slugs: readonly string[];
      readonly cells: readonly { slug: string; x: number; gap: number; height: number }[];
      setMood: (mood: HallMoodName) => void;
      setPose: (pose: LabPose) => void;
      focus: (slug: string, angle?: "front" | "three-quarter" | "back" | "top") => void;
      setCompare: (compare: boolean) => void;
      setBackdrop: (backdrop: Backdrop) => void;
    };
  }
}

interface Cell {
  readonly item: CatalogueItem;
  readonly x: number;
  readonly gap: number;
}

function layoutCells(items: readonly CatalogueItem[]): Cell[] {
  const cells: Cell[] = [];
  let cursor = 0;
  for (const item of items) {
    const gap = Math.max(item.width, item.depth) + 0.45;
    cells.push({ item, x: cursor, gap });
    cursor += gap * 2 + 0.4;
  }
  const centre = cursor / 2;
  return cells.map((cell) => ({ ...cell, x: cell.x - centre }));
}

function focusPose(cell: Cell, angle: "front" | "three-quarter" | "back" | "top"): LabPose {
  const { item } = cell;
  const size = Math.max(item.width, item.depth, item.height);
  const distance = 1.1 + size * 1.25;
  const middleX = cell.x + cell.gap / 2;
  const targetY = Math.min(item.height * 0.55, 1.2);
  switch (angle) {
    case "front":
      return { position: [middleX, targetY + size * 0.35, -distance * 1.15], target: [middleX, targetY, 0], fov: 38 };
    case "back":
      return { position: [middleX, targetY + size * 0.35, distance * 1.15], target: [middleX, targetY, 0], fov: 38 };
    case "top":
      return { position: [middleX, distance * 1.6, 0.01], target: [middleX, 0, 0], fov: 38 };
    case "three-quarter":
      return { position: [middleX - distance * 0.75, targetY + size * 0.55, -distance * 0.9], target: [middleX, targetY * 0.9, 0], fov: 38 };
  }
}

function PoseController({ pose }: { readonly pose: LabPose }): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls) as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
  useEffect(() => {
    camera.position.set(...pose.position);
    if ("fov" in camera && pose.fov !== undefined) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(...pose.target);
    controls?.target?.set(...pose.target);
    controls?.update?.();
    invalidate();
  }, [camera, controls, invalidate, pose]);
  return null;
}

export function FurnitureLabPage(): ReactElement {
  const search = new URLSearchParams(window.location.search);
  if (search.has("setup-looks")) return <SetupLookList />;
  const setup = search.get("setup");
  if (setup !== null) return <SetupLookStudio lookKey={setup} />;
  const previewSlug = search.get("preview");
  const previewItem = previewSlug === null ? undefined : getCatalogueItemBySlug(previewSlug);
  return previewItem === undefined ? <FurnitureGallery /> : <FurniturePreviewStudio item={previewItem} />;
}

const PREVIEW_BACKGROUND = "#dededc";

/** A neutral room for reflections, so chrome, brass and varnish read as they are. */
function StudioEnvironment(): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const renderer = getNativeRenderer(gl);
    if (renderer === null) return undefined;
    const generator = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    let target: RenderTarget | null = null;
    try {
      target = generator.fromScene(room, 0.04);
      scene.environment = target.texture;
      scene.environmentIntensity = 0.55;
      invalidate();
    } catch {
      // A preview without reflections is still a preview.
    }
    return () => {
      if (target !== null && scene.environment === target.texture) scene.environment = null;
      target?.dispose();
      generator.dispose();
      room.dispose();
    };
  }, [gl, invalidate, scene]);
  return null;
}

function NeutralTone(): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const previous = { mapping: gl.toneMapping, exposure: gl.toneMappingExposure };
    gl.toneMapping = NeutralToneMapping;
    gl.toneMappingExposure = 0.82;
    invalidate();
    return () => {
      gl.toneMapping = previous.mapping;
      gl.toneMappingExposure = previous.exposure;
    };
  }, [gl, invalidate]);
  return null;
}

/** The floor box and height a preview frames. */
interface PreviewBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly height: number;
}

function itemBox(item: CatalogueItem): PreviewBox {
  return { minX: -item.width / 2, maxX: item.width / 2, minZ: -item.depth / 2, maxZ: item.depth / 2, height: item.height };
}

/**
 * Frames a box from the front right and above, as the supplied previews
 * are: close enough that it fills the square with a margin, the box's
 * projection centred.
 */
function previewPose(box: PreviewBox): LabPose {
  const fov = 30;
  const tangent = Math.tan((fov * Math.PI) / 360) * 0.8;
  const elevation = (24 * Math.PI) / 180;
  const turn = Math.PI / 4;
  const forward = new Vector3(-Math.sin(turn) * Math.cos(elevation), -Math.sin(elevation), Math.cos(turn) * Math.cos(elevation));
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const corners: Vector3[] = [];
  for (const x of [box.minX, box.maxX]) {
    for (const y of [0, box.height]) {
      for (const z of [box.minZ, box.maxZ]) corners.push(new Vector3(x, y, z));
    }
  }
  const target = new Vector3((box.minX + box.maxX) / 2, box.height / 2, (box.minZ + box.maxZ) / 2);
  const fit = (): number => Math.max(...corners.map((corner) => {
    const offset = corner.clone().sub(target);
    const depth = offset.dot(forward);
    return Math.max(Math.abs(offset.dot(right)), Math.abs(offset.dot(up))) / tangent - depth;
  }));
  let distance = fit();
  // Centre the box's projection, then fit again.
  for (let pass = 0; pass < 2; pass += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const corner of corners) {
      const offset = corner.clone().sub(target);
      const depth = offset.dot(forward) + distance;
      xs.push(offset.dot(right) / depth);
      ys.push(offset.dot(up) / depth);
    }
    const shiftX = ((Math.max(...xs) + Math.min(...xs)) / 2) * distance;
    const shiftY = ((Math.max(...ys) + Math.min(...ys)) / 2) * distance;
    target.addScaledVector(right, shiftX).addScaledVector(up, shiftY);
    distance = fit();
  }
  const position = target.clone().addScaledVector(forward, -distance);
  return { position: [position.x, position.y, position.z], target: [target.x, target.y, target.z], fov };
}

/** Marks the preview ready a few frames after mounting, once its environment is in. */
function PreviewReady(): null {
  const frames = useRef(0);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    window.__furniturePreview = { ready: false };
    invalidate();
    return () => { delete window.__furniturePreview; };
  }, [invalidate]);
  useFrame(() => {
    frames.current += 1;
    if (frames.current < 4) invalidate();
    else if (window.__furniturePreview?.ready !== true) window.__furniturePreview = { ready: true };
  });
  return null;
}

/** The studio itself: background, tone, reflections, the key light scaled to what it frames, and the floor. */
function PreviewStudio({ pose, reach, children }: { readonly pose: LabPose; readonly reach: number; readonly children: ReactNode }): ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, background: PREVIEW_BACKGROUND }}>
      <Canvas frameloop="demand" dpr={[1, 2]} shadows="percentage" camera={{ fov: pose.fov, near: 0.02, far: 100, position: pose.position }}>
        <color attach="background" args={[PREVIEW_BACKGROUND]} />
        <NeutralTone />
        <StudioEnvironment />
        <hemisphereLight args={["#ffffff", "#a6a4a0", 0.45]} />
        <directionalLight
          castShadow
          position={[reach * 0.6, reach * 2.2, -reach * 1.1]}
          intensity={2.6}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-reach}
          shadow-camera-right={reach}
          shadow-camera-top={reach}
          shadow-camera-bottom={-reach}
          shadow-camera-near={0.1}
          shadow-camera-far={reach * 6}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color={PREVIEW_BACKGROUND} roughness={0.95} />
        </mesh>
        {children}
        <PoseController pose={pose} />
        <PreviewReady />
      </Canvas>
    </div>
  );
}

function FurniturePreviewStudio({ item }: { readonly item: CatalogueItem }): ReactElement {
  const pose = useMemo(() => previewPose(itemBox(item)), [item]);
  return (
    <PreviewStudio pose={pose} reach={Math.max(item.width, item.depth, item.height)}>
      <FurnitureProxy item={item} position={[0, 0, 0]} />
    </PreviewStudio>
  );
}

/** A setup look's lab address, `<card>/<look>`: its picture's card folder and file name. */
function setupLookKey(params: CardParams): string {
  return `${params.card}/${setupCardLook(params) ?? ""}`;
}

/** Every setup look and where its picture goes (`?setup-looks`), for the render script. */
function SetupLookList(): ReactElement {
  const looks = useMemo(() => setupCardLooks().flatMap((params) => {
    const url = setupCardPreviewUrl(params);
    return url === null ? [] : [{ key: setupLookKey(params), url }];
  }), []);
  useEffect(() => {
    window.__setupLooks = looks;
    return () => { delete window.__setupLooks; };
  }, [looks]);
  return (
    <ul>
      {looks.map(({ key, url }) => (
        <li key={key}><a href={`?setup=${encodeURIComponent(key)}`}>{key}</a> {url}</li>
      ))}
    </ul>
  );
}

/**
 * Why a look cannot be pictured truthfully, or null. A piece drawn from a
 * model file shows a stand-in while it loads, which the studio's frame count
 * would photograph, so a set holds only pieces drawn in code.
 */
function setupLookProblem(lookKey: string, params: CardParams | null, pieces: readonly PlacedItem[]): string | null {
  if (params === null) return `Not a setup look: ${lookKey}`;
  if (pieces.length === 0) return `${lookKey} sets down nothing`;
  for (const piece of pieces) {
    const item = getCatalogueItem(piece.catalogueItemId);
    if (item === undefined) return `${lookKey}: ${piece.catalogueItemId} is not in the catalogue`;
    if (standaloneFurnitureMeshUrl(item) !== null) return `${lookKey}: ${item.slug} loads a model file, so the picture could catch its stand-in`;
  }
  return null;
}

/** A setup card's look (`?setup=<card>/<look>`; card-dock Q-21), or why it cannot be pictured. */
function SetupLookStudio({ lookKey }: { readonly lookKey: string }): ReactElement {
  const params = useMemo(() => setupCardLooks().find((look) => setupLookKey(look) === lookKey) ?? null, [lookKey]);
  const pieces = useMemo(() => {
    if (params === null) return [];
    let next = 0;
    return stampSetup(params, { x: 0, z: 0 }, 0, () => {
      next += 1;
      return `setup-${String(next)}`;
    });
  }, [params]);
  const problem = useMemo(() => setupLookProblem(lookKey, params, pieces), [lookKey, params, pieces]);
  useEffect(() => {
    if (problem === null) return undefined;
    window.__furniturePreview = { ready: false, error: problem };
    return () => { delete window.__furniturePreview; };
  }, [problem]);
  return problem === null ? <SetupPreviewStudio pieces={pieces} /> : <p role="alert">{problem}</p>;
}

/**
 * A setup look's whole set in the same studio and framing as the crafted
 * previews: the pieces stampSetup puts down, framed by their joint box.
 */
function SetupPreviewStudio({ pieces }: { readonly pieces: readonly PlacedItem[] }): ReactElement {
  const drawn = useMemo(() => pieces.flatMap((piece) => {
    const item = getCatalogueItem(piece.catalogueItemId);
    return item === undefined ? [] : [{ piece, item }];
  }), [pieces]);
  const box = useMemo<PreviewBox>(() => {
    const bounds = footprintBounds(pieces) ?? { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
    return { ...bounds, height: Math.max(0.1, ...drawn.map(({ item }) => item.height)) };
  }, [drawn, pieces]);
  const pose = useMemo(() => previewPose(box), [box]);
  const reach = Math.max(box.maxX - box.minX, box.maxZ - box.minZ, box.height);
  return (
    <PreviewStudio pose={pose} reach={reach}>
      {drawn.map(({ piece, item }) => (
        <FurnitureProxy key={piece.id} item={item} position={[piece.x, piece.y, piece.z]} rotationY={piece.rotationY} />
      ))}
    </PreviewStudio>
  );
}

function FurnitureGallery(): ReactElement {
  // Every crafted piece, then every supplied model not yet crafted, for reference.
  const items = useMemo(
    () => [
      ...CATALOGUE_ITEMS.filter((item) => isCraftedFurnitureSlug(item.slug)),
      ...CATALOGUE_ITEMS.filter((item) => item.meshUrl !== null && !isCraftedFurnitureSlug(item.slug)),
    ],
    [],
  );
  const cells = useMemo(() => layoutCells(items), [items]);
  const [mood, setMood] = useState<HallMoodName>("daylight");
  const [compare, setCompare] = useState(true);
  const [backdrop, setBackdrop] = useState<Backdrop>("studio");
  const [pose, setPose] = useState<LabPose>({ position: [0, 6, -12], target: [0, 0.5, 0], fov: 40 });

  useEffect(() => {
    window.__furnitureLab = {
      slugs: cells.map((cell) => cell.item.slug),
      cells: cells.map((cell) => ({ slug: cell.item.slug, x: cell.x, gap: cell.gap, height: cell.item.height })),
      setMood,
      setPose,
      focus: (slug, angle = "three-quarter") => {
        const cell = cells.find((candidate) => candidate.item.slug === slug);
        if (cell !== undefined) setPose(focusPose(cell, angle));
      },
      setCompare,
      setBackdrop,
    };
    return () => { delete window.__furnitureLab; };
  }, [cells]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0d0b09" }}>
      <Canvas frameloop="demand" dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 40, near: 0.05, far: 200, position: [0, 6, -12] }}>
        <color attach="background" args={[backdrop === "hall" ? "#120e0b" : "#2a2622"]} />
        <CaptureToneMapping captureShown={false} photographedRoom />
        <HallLightRig mood={mood} finish={FULL_HALL_FINISH} />
        {backdrop === "hall" ? (
          <GrandHallModel mood={mood} view="walk" finish={FULL_HALL_FINISH} />
        ) : (
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[60, 30]} />
            <meshStandardMaterial color="#8a7a66" roughness={0.6} />
          </mesh>
        )}
        {cells.map((cell) => (
          <group key={cell.item.slug}>
            <FurnitureProxy item={cell.item} position={[cell.x, 0, 0]} />
            {compare && cell.item.meshUrl !== null ? (
              <group position={[cell.x + cell.gap, 0, 0]}>
                <MeshErrorBoundary fallback={null} meshUrl={cell.item.meshUrl}>
                  <Suspense fallback={null}>
                    <GltfFurniture meshUrl={cell.item.meshUrl} item={cell.item} />
                  </Suspense>
                </MeshErrorBoundary>
              </group>
            ) : null}
          </group>
        ))}
        <OrbitControls makeDefault enableDamping target={[0, 0.5, 0]} />
        <PoseController pose={pose} />
      </Canvas>
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 8, fontFamily: "Inter, sans-serif" }}>
        {HALL_MOOD_NAMES.map((name) => (
          <button key={name} type="button" onClick={() => { setMood(name); }} aria-pressed={mood === name}>{name}</button>
        ))}
        <button type="button" onClick={() => { setCompare((value) => !value); }} aria-pressed={compare}>compare</button>
        <button type="button" onClick={() => { setBackdrop((value) => (value === "hall" ? "studio" : "hall")); }} aria-pressed={backdrop === "hall"}>hall</button>
      </div>
    </div>
  );
}
